// PokeJourneys: PLAYER LOOK for the DS games (journeys/CreatorLookDs.kt). Blocks written over the cart's ROM image in
// melonDS's memory, the way the GBA side's pk_cheats_block puts them over mGBA's: each only where the bytes there still
// have the CRC32 the app read from the file, all or none, the bytes under them kept so the next call (or none) puts
// them back. The .nds file is never written. The game reads its overworld sprites from the cart each time it builds
// the map's objects, so a change shows from the next map load.
#include <jni.h>
#include <cstring>
#include <vector>
#include "pk_nds.h"

namespace {

struct Kept {
    uint32_t off;
    std::vector<uint8_t> bytes;
    std::vector<uint8_t> wrote;
};

std::vector<Kept> kept;
const uint8_t* keptRom = nullptr;

uint32_t crc32(const uint8_t* p, uint32_t n)
{
    uint32_t c = 0xFFFFFFFFu;
    for (uint32_t i = 0; i < n; i++) {
        c ^= p[i];
        for (int k = 0; k < 8; k++) c = (c >> 1) ^ (0xEDB88320u & (0u - (c & 1u)));
    }
    return ~c;
}

void restore(uint8_t* rom)
{
    // A ROM loaded since (another game) has none of ours in it.
    if (rom && rom == keptRom)
        for (auto it = kept.rbegin(); it != kept.rend(); ++it)
            if (it->off + it->wrote.size() <= pk_nds_rom_size() && !memcmp(rom + it->off, it->wrote.data(), it->wrote.size()))
                memcpy(rom + it->off, it->bytes.data(), it->bytes.size());
    kept.clear();
    keptRom = nullptr;
}

} // namespace

extern "C" JNIEXPORT jint JNICALL
Java_com_pokedaisy_app_journeys_CreatorLookDs_pkNdsRomBlocks(JNIEnv* env, jclass, jintArray jOffs, jintArray jLens, jintArray jCrcs, jbyteArray jData)
{
    uint8_t* rom = pk_nds_active() ? pk_nds_rom_image() : nullptr;
    uint32_t size = rom ? pk_nds_rom_size() : 0;
    restore(rom);
    if (!rom || !jOffs) return rom ? 0 : -1;
    jsize n = env->GetArrayLength(jOffs);
    std::vector<jint> offs(n), lens(n), crcs(n);
    env->GetIntArrayRegion(jOffs, 0, n, offs.data());
    env->GetIntArrayRegion(jLens, 0, n, lens.data());
    env->GetIntArrayRegion(jCrcs, 0, n, crcs.data());
    std::vector<uint8_t> data(env->GetArrayLength(jData));
    env->GetByteArrayRegion(jData, 0, (jsize) data.size(), (jbyte*) data.data());
    uint64_t at = 0;
    for (jsize i = 0; i < n; i++) {
        uint32_t off = (uint32_t) offs[i], len = (uint32_t) lens[i];
        if ((uint64_t) off + len > size || at + len > data.size() || crc32(rom + off, len) != (uint32_t) crcs[i]) return -1;
        at += len;
    }
    at = 0;
    keptRom = rom;
    for (jsize i = 0; i < n; i++) {
        uint32_t off = (uint32_t) offs[i], len = (uint32_t) lens[i];
        kept.push_back(Kept {off, std::vector<uint8_t>(rom + off, rom + off + len), std::vector<uint8_t>(data.data() + at, data.data() + at + len)});
        memcpy(rom + off, data.data() + at, len);
        at += len;
    }
    return n;
}
