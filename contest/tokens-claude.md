# Tokens i molnet (Claude Code, claude-opus-5-5)

Framtaget 2026-11-06 med `node contest/tokens-claude.js` ur Claude Codes egna sessionsloggar (~/.claude/projects/…/*.jsonl). Varje svar räknas en gång (unikt message.id). Underagenter (granskningsrundorna) ingår.

*Cache läs* är text som redan låg i modellens cache och lästes om vid varje svar (hela samtalet hittills). Det är den största posten men den billigaste. Ny text in = Input + Cache skriv.

## Per dag

| | Svar | Input | Output | Cache skriv | Cache läs | Totalt |
|---|---:|---:|---:|---:|---:|---:|
| 2026-10-25 | 67 | 134 | 81 700 | 153 311 | 7 764 258 | 7 999 403 |
| 2026-10-26 | 65 | 128 | 133 520 | 216 244 | 10 498 975 | 10 848 867 |
| 2026-11-03 | 162 | 336 | 275 808 | 576 199 | 42 742 661 | 43 595 004 |
| 2026-11-04 | 232 | 504 | 320 855 | 1 122 690 | 141 060 734 | 142 504 783 |
| 2026-11-05 | 1 254 | 2 622 | 1 260 686 | 5 357 980 | 282 174 219 | 288 795 507 |
| 2026-11-06 | 24 | 50 | 13 571 | 704 728 | 3 545 510 | 4 263 859 |

## Per session (huvud / underagenter)

| | Svar | Input | Output | Cache skriv | Cache läs | Totalt |
|---|---:|---:|---:|---:|---:|---:|
| 08fcfa95 huvud | 65 | 128 | 133 520 | 216 244 | 10 498 975 | 10 848 867 |
| 499594f9 huvud | 358 | 762 | 567 486 | 1 514 480 | 181 305 552 | 183 388 280 |
| 499594f9 underagenter | 36 | 78 | 29 177 | 184 409 | 2 497 843 | 2 711 507 |
| 7f210c22 huvud | 67 | 134 | 81 700 | 153 311 | 7 764 258 | 7 999 403 |
| 9d9ccacb huvud | 559 | 1 208 | 599 760 | 2 703 096 | 208 447 649 | 211 751 713 |
| 9d9ccacb underagenter | 719 | 1 464 | 674 497 | 3 359 612 | 77 272 080 | 81 307 653 |

## Per modell

| | Svar | Input | Output | Cache skriv | Cache läs | Totalt |
|---|---:|---:|---:|---:|---:|---:|
| <synthetic> | 7 | 0 | 0 | 0 | 0 | 0 |
| claude-opus-5-5 | 1 797 | 3 774 | 2 086 140 | 8 131 152 | 487 786 357 | 498 007 423 |

## Totalt

| | Svar | Input | Output | Cache skriv | Cache läs | Totalt |
|---|---:|---:|---:|---:|---:|---:|
| alla | 1 804 | 3 774 | 2 086 140 | 8 131 152 | 487 786 357 | 498 007 423 |

Filer: 28, unika svar: 1804
