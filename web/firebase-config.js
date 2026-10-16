/* Firebase project for player sign-in and the leaderboard.

   While this is null the site works as before: players type a name and the
   leaderboard lives on textdb.online. Paste the web app config from the
   Firebase console (Project settings → Your apps → SDK setup and
   configuration → Config) to switch on Google / email sign-in. These values
   identify the project, they are not secrets — access is controlled by
   firestore.rules. See README → "Player sign-in". */
window.SPINXI_FIREBASE = null;

/* Example:
window.SPINXI_FIREBASE = {
  apiKey: "AIza...",
  authDomain: "spin-xi.firebaseapp.com",
  projectId: "spin-xi",
  appId: "1:1234567890:web:abc123",
};
*/
