# spellbee

spellbee is a small spelling game that the user builds for their kids: the game reads a word aloud, and the kid types it. The kids get 10 words a week from school.

## Stack

A static site: one HTML page, TypeScript, Vite, the speech API of the browser, the word lists as JSON files, local storage for the scores. Hosted on a static host.

## Timeline (days relative to today, negative is the past)

- Day -820: the project starts (already written). No entry may suggest that the project existed before.
- -819 to -700: the first weeks: the word list for each week, the voice settings (speed, which voice), the score board, sound effects for right and wrong answers, it works on the tablet.
- -700 to -450: the hint button (show the first letter), a parent page to type in the words of the week, streaks, a second kid with their own profile, an offline mode (a service worker).
- -450 to -151: less work: fixes for a new browser version, a voice that disappeared after an update, new word lists, a small redesign. Toward the end, the kids use it less, because the school has its own app now.
- Day -150: the project is archived (already written). There is no entry after it.

## Branches

None. Every session runs in the main checkout.
