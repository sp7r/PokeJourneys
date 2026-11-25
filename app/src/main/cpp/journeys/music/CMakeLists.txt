# The hub's music (hub_music.cpp): SSEQPlayer renders songs from the player's DS cartridges, qoa.h encodes them.
add_library(hubmusic SHARED hub_music.cpp qoa.c
    sseqplayer/Channel.cpp sseqplayer/FATSection.cpp sseqplayer/INFOEntry.cpp sseqplayer/INFOSection.cpp
    sseqplayer/NDSStdHeader.cpp sseqplayer/Player.cpp sseqplayer/SBNK.cpp sseqplayer/SDAT.cpp sseqplayer/SSEQ.cpp
    sseqplayer/SWAR.cpp sseqplayer/SWAV.cpp sseqplayer/SYMBSection.cpp sseqplayer/Track.cpp)
set_target_properties(hubmusic PROPERTIES CXX_STANDARD 17 CXX_STANDARD_REQUIRED ON)
