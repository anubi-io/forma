These codec fixtures contain generated G-code and UTF-8 comments, compressed by
Makera's QuickLZ 1.5 reference C compressor at levels 1 and 3, then wrapped using
the controller's `compress_file` block format. Each block was also decoded by the
reference C decompressor and compared byte for byte before saving the fixture.

Sources:

- https://github.com/MakeraInc/CarveraFirmware/blob/master/src/modules/utils/player/quicklz.c
- https://github.com/MakeraInc/CarveraFirmware/blob/master/src/modules/utils/player/quicklz.h
- https://github.com/MakeraInc/CarveraController/blob/main/src/makera.py

The generator splits UTF-8 input every 4096 bytes, starts with zeroed compressor
state for each block, prefixes each compressed block with its unsigned 32-bit
big-endian length, and appends `sum(input bytes) & 65535` as a 16-bit big-endian
checksum. The JSON stores the original text and the complete container as hex.
Cases exercise short and long headers, compressed references, stored data,
multiple blocks, overlapping copies, and UTF-8 sequences split across blocks.

The C reference implementation is used only to produce test data; it is not
included in or shipped with the application. The application codec is a bounded
format reader written for this project.
