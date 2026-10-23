# Sample inbound messages (all made up)

Use these to test your flow. Each one is labelled with what a good system should do.

| # | From (test church) | Message | A good system... |
|---|---|---|---|
| 1 | T001 (es, 2G) | `hola quiero registrar mi iglesia` | starts registration in Spanish |
| 2 | T004 (pt) | `Oi! Somos da Igreja Fonte de Vida, Recife. Pastor João.` | extracts church, city and pastor, asks only for what is missing |
| 3 | T002 | `14 bautismos` | records 14 for Comunidad Agua Viva and confirms back |
| 3b | T002 again, 10 min later | `14 bautismos` | flags a likely duplicate and asks before counting it twice |
| 4 | T005 | `nove` | understands "nine" in Portuguese, or asks to confirm |
| 5 | T011 | `5000` | flags an impossible count for a small church and asks to confirm |
| 6 | T003 | `muchos!!! gloria a Dios 🙌` | thanks them and asks for a number |
| 7 | Unknown number | `baptisms 30` | asks them to register first; does not count it |
| 8 | T008 | `STOP` | stops all messages and confirms |
| 9 | T009 (Quechua speaker) | a message in Quechua (have a teammate or a translator write one) | answers in Quechua or offers Spanish, and never guesses at a translation it is unsure of |
| 10 | T006 | a photo of a handwritten tally sheet | asks for the number as text, or reads it and confirms |
