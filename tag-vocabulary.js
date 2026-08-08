// Shared "vibe" tag vocabulary — generated automatically (see scripts/embeddings/generate-tags.js)
// by comparing each movie's existing embedding against a short descriptive phrase for each tag,
// rather than a bare keyword. A single word like "heist" embeds ambiguously; a full phrase like
// "a group plans and executes an elaborate heist to steal something valuable" embeds much closer
// to what a heist movie's own overview actually sounds like — calibrated by hand against a few
// known movies (Ocean's Eleven/heist, Bourne Identity/amnesia, Shawshank/redemption arc, The
// Notebook/slow burn romance, Knives Out/whodunit) before picking this phrasing style.
//
// `label` is what's shown in the UI and what filter params match against; `phrase` is only used
// at generation time to compute the tag's embedding.
const TAG_VOCABULARY = [
  // Plot devices
  { label: "Heist", phrase: "a group plans and executes an elaborate heist to steal something valuable" },
  { label: "Amnesia", phrase: "a character suffers from amnesia and struggles to recover lost memories" },
  { label: "Time Travel", phrase: "characters travel through time to the past or future" },
  { label: "Redemption Arc", phrase: "a flawed character seeks redemption for past mistakes" },
  { label: "Whodunit", phrase: "a detective investigates clues to solve a baffling murder mystery" },
  { label: "Revenge", phrase: "a character methodically seeks revenge against those who wronged them" },
  { label: "Plot Twist", phrase: "a story with a shocking twist ending that changes everything" },
  { label: "Kidnapping", phrase: "a character is kidnapped and held captive against their will" },
  { label: "Undercover", phrase: "a character goes undercover in a dangerous operation to infiltrate criminals" },
  { label: "Conspiracy", phrase: "characters slowly uncover a vast, dangerous conspiracy" },
  { label: "Prison Escape", phrase: "prisoners plan a daring, meticulous escape from prison" },
  { label: "Survival", phrase: "characters struggle to survive against overwhelming odds in the wilderness" },
  { label: "Courtroom Drama", phrase: "a dramatic legal trial unfolds in a courtroom" },
  { label: "Road Trip", phrase: "characters go on an eventful road trip together" },
  { label: "Based on a True Story", phrase: "a dramatization of real historical events and real people" },
  { label: "Body Swap", phrase: "two characters magically swap bodies or identities with each other" },
  { label: "Double Life", phrase: "a character secretly leads a double life hidden from everyone" },
  { label: "Mistaken Identity", phrase: "a character is mistaken for someone else with comic or dangerous consequences" },
  { label: "Fish Out of Water", phrase: "a character is thrust into a completely unfamiliar world or situation" },
  { label: "Coming of Age", phrase: "a young person grows up and matures through formative experiences" },
  { label: "Underdog Story", phrase: "an unlikely underdog overcomes the odds to triumph" },

  // Relationships / emotional
  { label: "Slow Burn Romance", phrase: "two characters slowly and tentatively fall in love over time" },
  { label: "Love Triangle", phrase: "a character is torn between two competing romantic interests" },
  { label: "Forbidden Love", phrase: "two characters fall in love despite being forbidden to be together" },
  { label: "Found Family", phrase: "a group of unrelated misfits come together to form a found family" },
  { label: "Unlikely Friendship", phrase: "an unlikely, mismatched friendship forms between very different characters" },
  { label: "Workplace Romance", phrase: "a secret romance develops between two coworkers" },
  { label: "Second Chances", phrase: "characters get an unexpected second chance at love or life" },
  { label: "Grief and Loss", phrase: "a character copes with deep grief after losing a loved one" },
  { label: "Family Drama", phrase: "a story about simmering conflict and dysfunction within a family" },
  { label: "Marriage in Crisis", phrase: "a troubled marriage is tested by betrayal and crisis" },
  { label: "Reunited Lovers", phrase: "former lovers are unexpectedly reunited after years apart" },
  { label: "Sibling Rivalry", phrase: "rival siblings compete and clash bitterly with each other" },
  { label: "Betrayal", phrase: "a character is deeply betrayed by someone they trusted" },

  // Tone
  { label: "Dark Comedy", phrase: "a comedy with dark, morbid, and cynical humor" },
  { label: "Feel Good", phrase: "an uplifting, heartwarming, feel-good story" },
  { label: "Tearjerker", phrase: "an emotionally devastating tearjerker that will make you cry" },
  { label: "Slasher", phrase: "a masked killer stalks and murders victims one by one" },
  { label: "Psychological Thriller", phrase: "a tense psychological thriller that plays tricks on the mind" },
  { label: "Satire", phrase: "a biting satire that mocks society, politics, or institutions" },
  { label: "Slapstick Comedy", phrase: "silly, exaggerated physical slapstick comedy" },
  { label: "Romantic Comedy", phrase: "a lighthearted, funny romantic comedy" },
  { label: "Gritty and Violent", phrase: "a gritty, brutal, and violent crime story" },
  { label: "Suspenseful", phrase: "a tense, nail-biting, suspenseful story that keeps you on edge" },
  { label: "Quirky and Offbeat", phrase: "a quirky, offbeat story full of eccentric characters" },
  { label: "Epic Adventure", phrase: "a sweeping, grand-scale epic adventure" },

  // Setting / premise
  { label: "Dystopian Future", phrase: "a bleak dystopian future where society has collapsed" },
  { label: "Small Town", phrase: "a story set in a close-knit small town where everyone knows each other" },
  { label: "High School", phrase: "a story set in high school among teenagers navigating cliques and drama" },
  { label: "Wedding", phrase: "a chaotic, emotional story centered around a wedding" },
  { label: "Holiday Movie", phrase: "a heartwarming holiday or Christmas movie" },
  { label: "War", phrase: "a harrowing story set during wartime and combat" },
  { label: "Space Adventure", phrase: "a science fiction adventure set among the stars in outer space" },
  { label: "Post-Apocalyptic", phrase: "survivors navigate a ravaged post-apocalyptic wasteland" },
  { label: "Haunted House", phrase: "characters are terrorized by supernatural forces in a haunted house" },
  { label: "Supernatural", phrase: "supernatural forces, ghosts, or the paranormal are at play" },
  { label: "Zombie Outbreak", phrase: "a zombie outbreak threatens to wipe out humanity" },
  { label: "Alien Invasion", phrase: "an alien invasion threatens the Earth" },
  { label: "Superhero Origin", phrase: "a hero discovers and comes to embrace their superpowers" },
  { label: "Sports Underdog", phrase: "an underdog athlete or team fights for an against-the-odds victory" },
  { label: "Music and Performance", phrase: "a musician or performer chases their dream on stage" },
  { label: "Island Getaway", phrase: "characters are stranded or vacationing on a remote tropical island" },
  { label: "Prison", phrase: "a story set inside the walls of a prison" },
  { label: "Medical Drama", phrase: "a dramatic story set in a hospital among doctors and patients" },
  { label: "Political Drama", phrase: "a story of political intrigue, ambition, and the pursuit of power" },
  { label: "Spy Espionage", phrase: "a spy carries out dangerous, high-stakes espionage missions" },
  { label: "Martial Arts", phrase: "a story centered on skilled martial arts combat" },
  { label: "Monster Creature Feature", phrase: "a terrifying monster or creature stalks and terrorizes people" },
];

module.exports = { TAG_VOCABULARY };
