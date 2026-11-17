# Tokens till tävlingen

Framtaget 2026-11-17 23:37 med `node contest/tokens-claude.js`.

## Till formuläret

| Fält | Värde |
|---|---|
| Tokens betalda i molnet | **1 045 587 427** (input 7 624 + cache-skrivning 20 291 158 + cache-läsning 1 021 142 240 + output 4 146 405) |
| Tokens bearbetade lokalt | **48 965** (minst; 26 anrop, 45 940 in och 3 025 ut) |

Cacheläsning (1 021 142 240) är text som redan låg i modellens cache, till exempel koden och samtalet hittills, och lästes om vid varje svar. Den räknas med ovan eftersom den också debiteras, men till en lägre taxa. Bara ny text: input + cache-skrivning + output = 24 445 187.

Källor: 32 loggfiler i Claude Codes två loggmappar för projektet (före och efter bytet av mappnamn), 3 544 unika svar, samt ai-tokens-2026-11-17.jsonl.

## Molnet per dag

| | Svar | Input | Output | Cache skriv | Cache läs | Totalt |
|---|---:|---:|---:|---:|---:|---:|
| 2026-10-25 | 67 | 134 | 81 700 | 153 311 | 7 764 258 | 7 999 403 |
| 2026-10-26 | 65 | 128 | 133 520 | 216 244 | 10 498 975 | 10 848 867 |
| 2026-11-03 | 162 | 336 | 275 808 | 576 199 | 42 742 661 | 43 595 004 |
| 2026-11-04 | 232 | 504 | 320 855 | 1 122 690 | 141 060 734 | 142 504 783 |
| 2026-11-05 | 1 254 | 2 622 | 1 260 686 | 5 357 980 | 282 174 219 | 288 795 507 |
| 2026-11-06 | 153 | 338 | 190 582 | 1 038 819 | 35 288 756 | 36 518 495 |
| 2026-11-07 | 75 | 174 | 83 178 | 471 105 | 33 657 665 | 34 212 122 |
| 2026-11-08 | 26 | 70 | 46 081 | 568 047 | 13 778 020 | 14 392 218 |
| 2026-11-09 | 129 | 306 | 187 995 | 2 205 225 | 89 909 142 | 92 302 668 |
| 2026-11-10 | 279 | 620 | 295 838 | 887 872 | 59 100 555 | 60 284 885 |
| 2026-11-12 | 222 | 470 | 187 001 | 1 688 158 | 50 429 248 | 52 304 877 |
| 2026-11-13 | 115 | 248 | 142 550 | 1 172 728 | 28 364 872 | 29 680 398 |
| 2026-11-14 | 111 | 256 | 197 218 | 597 915 | 26 419 692 | 27 215 081 |
| 2026-11-15 | 66 | 142 | 71 118 | 1 709 508 | 35 398 906 | 37 179 674 |
| 2026-11-16 | 308 | 688 | 410 657 | 1 886 658 | 97 032 849 | 99 330 852 |
| 2026-11-17 | 280 | 588 | 261 618 | 638 699 | 67 521 688 | 68 422 593 |

## Molnet per session (huvud / underagenter)

| | Svar | Input | Output | Cache skriv | Cache läs | Totalt |
|---|---:|---:|---:|---:|---:|---:|
| 08fcfa95 huvud | 65 | 128 | 133 520 | 216 244 | 10 498 975 | 10 848 867 |
| 499594f9 huvud | 1 057 | 2 368 | 1 563 259 | 7 653 464 | 452 022 340 | 461 241 431 |
| 499594f9 underagenter | 36 | 78 | 29 177 | 184 409 | 2 497 843 | 2 711 507 |
| 7f210c22 huvud | 67 | 134 | 81 700 | 153 311 | 7 764 258 | 7 999 403 |
| 9d9ccacb huvud | 987 | 2 158 | 1 051 040 | 6 625 925 | 336 615 458 | 344 294 581 |
| 9d9ccacb underagenter | 864 | 1 760 | 782 652 | 3 729 156 | 94 548 692 | 99 062 260 |
| a00d5581 huvud | 188 | 410 | 243 439 | 1 089 950 | 49 672 986 | 51 006 785 |
| c87e51ce huvud | 280 | 588 | 261 618 | 638 699 | 67 521 688 | 68 422 593 |

## Molnet per modell

| | Svar | Input | Output | Cache skriv | Cache läs | Totalt |
|---|---:|---:|---:|---:|---:|---:|
| <synthetic> | 11 | 0 | 0 | 0 | 0 | 0 |
| claude-fable-5-2 | 247 | 560 | 397 997 | 2 106 117 | 90 385 367 | 92 890 041 |
| claude-opus-5-5 | 3 286 | 7 064 | 3 748 408 | 18 185 041 | 930 756 873 | 952 697 386 |

## Molnet totalt

| | Svar | Input | Output | Cache skriv | Cache läs | Totalt |
|---|---:|---:|---:|---:|---:|---:|
| alla | 3 544 | 7 624 | 4 146 405 | 20 291 158 | 1 021 142 240 | 1 045 587 427 |

## Lokalt per dag (Ollama, loggat sedan 6 november)

| | Anrop | In | Ut | Totalt |
|---|---:|---:|---:|---:|
| 2026-11-06 | 1 | 705 | 70 | 775 |
| 2026-11-07 | 5 | 3 534 | 340 | 3 874 |
| 2026-11-08 | 3 | 2 183 | 198 | 2 381 |
| 2026-11-09 | 2 | 1 471 | 137 | 1 608 |
| 2026-11-10 | 3 | 2 214 | 211 | 2 425 |
| 2026-11-12 | 3 | 2 288 | 176 | 2 464 |
| 2026-11-14 | 3 | 11 446 | 918 | 12 364 |
| 2026-11-15 | 2 | 1 598 | 113 | 1 711 |
| 2026-11-16 | 4 | 20 501 | 862 | 21 363 |

Typer av anrop: interpret 22, ask 4. Användningen 3–6 november loggades inte, så det lokala är räknat i underkant.
