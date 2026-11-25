// The hub's music: renders one song of a DS cartridge's sound archive (SDAT) with SSEQPlayer, up to the end of its
// loop's second pass, and saves it as QOA (which Godot plays natively) with where the loop begins and ends. The loop
// is the second pass, so notes still ringing when the song jumps back are already in it and the loop is seamless.
// Built into libhubmusic.so (HubMusic.kt); with HUBMUSIC_CLI it is a command-line tool for testing.

#include "sseqplayer/SDAT.h"
#include "sseqplayer/Player.h"

extern "C" {
#include "qoa.h"
}

#include <cstdio>
#include <cstdlib>
#include <memory>
#include <string>
#include <vector>

namespace {

constexpr uint32_t RATE = 32728;             // the DS's own output rate
constexpr uint64_t LONGEST = RATE * 60 * 8;  // a song that never loops stops here
constexpr unsigned CHUNK = 1024;

struct Song {
    std::vector<int16_t> pcm;  // stereo, interleaved
    uint64_t frames = 0, loopBegin = 0, loopEnd = 0;
};

bool readSdat(const char *rom, long offset, long length, std::vector<uint8_t> &out)
{
    FILE *f = fopen(rom, "rb");
    if (!f) return false;
    out.resize(length);
    bool ok = fseek(f, offset, SEEK_SET) == 0 && fread(out.data(), 1, length, f) == static_cast<size_t>(length);
    fclose(f);
    return ok;
}

// The song's loop: the latest first jump back among the tracks, and that track's second one.
bool findLoop(const Player &p, uint64_t &begin, uint64_t &end)
{
    int track = -1;
    for (int t = 0; t < FSS_MAXTRACKS; ++t)
        if (!p.loopJumps[t].empty() && (track < 0 || p.loopJumps[t][0] > p.loopJumps[track][0])) track = t;
    if (track < 0 || p.loopJumps[track].size() < 2) return false;
    begin = p.loopJumps[track][0];
    end = p.loopJumps[track][1];
    return true;
}

bool silent(const Player &p)
{
    for (uint8_t i = 0; i < p.nTracks; ++i)
        if (!p.tracks[p.trackIds[i]].state[TS_END]) return false;
    for (const Channel &c : p.channels)
        if (c.state != CS_NONE) return false;
    return true;
}

void render(std::vector<uint8_t> &sdatBytes, int seq, Song &song)
{
    PseudoFile file;
    file.data = &sdatBytes;
    file.pos = 0;
    SDAT sdat(file, seq);
    std::unique_ptr<Player> p(new Player());
    p->sampleRate = RATE;
    p->interpolation = INTERPOLATION_4POINTLEGRANGE;
    p->Setup(sdat.sseq.get());
    p->sseqVol = Cnv_Scale(sdat.sseq->info.vol);
    p->masterVol = -20; // 2 dB down (tenths of a decibel): the loudest songs clipped a few samples at full volume
    std::vector<uint8_t> buf(CHUNK * 4);
    std::vector<int16_t> &pcm = song.pcm;
    bool looped = false;
    while (p->sampleIndex < LONGEST) {
        p->GenerateSamples(buf, 0, CHUNK);
        size_t at = pcm.size();
        pcm.resize(at + CHUNK * 2);
        for (unsigned i = 0; i < CHUNK * 2; ++i) pcm[at + i] = static_cast<int16_t>(buf[i * 2] | (buf[i * 2 + 1] << 8));
        if (findLoop(*p, song.loopBegin, song.loopEnd)) { looped = true; break; }
        if (silent(*p)) break;
    }
    song.frames = looped ? song.loopEnd : pcm.size() / 2;
    pcm.resize(song.frames * 2);
    if (!looped) { song.loopBegin = 0; song.loopEnd = song.frames; }
}

// Renders and saves a song; false (with the reason in error) when it can't.
bool save(const char *rom, long offset, long length, int seq, const char *out, Song &song, std::string &error)
{
    std::vector<uint8_t> sdat;
    if (!readSdat(rom, offset, length, sdat)) { error = "can't read the sound archive"; return false; }
    try { render(sdat, seq, song); } catch (const std::exception &e) { error = e.what(); return false; }
    qoa_desc desc = {};
    desc.channels = 2;
    desc.samplerate = RATE;
    desc.samples = static_cast<unsigned>(song.frames);
    unsigned size = 0;
    void *qoa = qoa_encode(song.pcm.data(), &desc, &size);
    if (!qoa) { error = "can't encode"; return false; }
    FILE *f = fopen(out, "wb");
    bool ok = f && fwrite(qoa, 1, size, f) == size;
    if (f) fclose(f);
    free(qoa);
    if (!ok) error = std::string("can't write ") + out;
    return ok;
}

} // namespace

#ifdef HUBMUSIC_CLI

// hubmusic <rom> <sdat offset> <sdat length> <sequence> <out.qoa> [out.wav]
int main(int argc, char **argv)
{
    if (argc < 6) { fprintf(stderr, "usage: hubmusic rom offset length sequence out.qoa [out.wav]\n"); return 2; }
    Song song;
    std::string error;
    if (!save(argv[1], atol(argv[2]), atol(argv[3]), atoi(argv[4]), argv[5], song, error)) { fprintf(stderr, "%s\n", error.c_str()); return 1; }
    printf("frames %llu loop %llu %llu rate %u\n", (unsigned long long)song.frames, (unsigned long long)song.loopBegin,
        (unsigned long long)song.loopEnd, RATE);
    if (argc > 6) {
        FILE *f = fopen(argv[6], "wb");
        uint32_t bytes = static_cast<uint32_t>(song.pcm.size() * 2), rate = RATE, byteRate = RATE * 4, n;
        fwrite("RIFF", 1, 4, f); n = 36 + bytes; fwrite(&n, 4, 1, f); fwrite("WAVEfmt ", 1, 8, f);
        n = 16; fwrite(&n, 4, 1, f);
        uint16_t pcmFormat = 1, channels = 2, align = 4, bits = 16;
        fwrite(&pcmFormat, 2, 1, f); fwrite(&channels, 2, 1, f); fwrite(&rate, 4, 1, f); fwrite(&byteRate, 4, 1, f);
        fwrite(&align, 2, 1, f); fwrite(&bits, 2, 1, f);
        fwrite("data", 1, 4, f); fwrite(&bytes, 4, 1, f); fwrite(song.pcm.data(), 2, song.pcm.size(), f);
        fclose(f);
    }
    return 0;
}

#else

#include <jni.h>

// HubMusic.render: [frames, loop begin, loop end, rate], or null with the reason in the log.
extern "C" JNIEXPORT jlongArray JNICALL
Java_com_pokedaisy_app_journeys_HubMusic_render(JNIEnv *env, jobject, jstring rom, jlong offset, jlong length, jint seq, jstring out)
{
    const char *romPath = env->GetStringUTFChars(rom, nullptr);
    const char *outPath = env->GetStringUTFChars(out, nullptr);
    Song song;
    std::string error;
    bool ok = save(romPath, static_cast<long>(offset), static_cast<long>(length), seq, outPath, song, error);
    env->ReleaseStringUTFChars(rom, romPath);
    env->ReleaseStringUTFChars(out, outPath);
    if (!ok) {
        env->ThrowNew(env->FindClass("java/io/IOException"), error.c_str());
        return nullptr;
    }
    jlong values[4] = { static_cast<jlong>(song.frames), static_cast<jlong>(song.loopBegin), static_cast<jlong>(song.loopEnd), RATE };
    jlongArray result = env->NewLongArray(4);
    env->SetLongArrayRegion(result, 0, 4, values);
    return result;
}

#endif
