/* Firebase project for player sign-in and the leaderboard.

   Set this to null and the site works as before: players type a name and the
   leaderboard lives on textdb.online. Paste the web app config from the
   Firebase console (Project settings → Your apps → SDK setup and
   configuration → Config) to switch on Google / email sign-in. These values
   identify the project, they are not secrets — access is controlled by
   firestore.rules. See README → "Player sign-in". */
window.SPINXI_FIREBASE = {
  apiKey: "AIzaSyDcOXHyS-uV9mbbdVeTXK__hBMs8jHvDLU",
  authDomain: "spin-xi-f4810.firebaseapp.com",
  projectId: "spin-xi-f4810",
  appId: "1:661084645226:web:d481d913cd0af1c042a713",
};
