/* ================================================================
   Spin XI — player sign-in (Google or emailed link) + leaderboard store
   Loaded by app.js only when window.SPINXI_FIREBASE is set.

   Firestore layout (see firestore.rules):
     players/{uid}  { name, updated, last, entries: { <entryId>: {comp, label, gw,
                      formation, picks, captain, at} } }
       `at` is the server's clock, so an entry's time can't be faked.
       Entries can be added (one per write, `last` names it) but never
       changed or removed.
     legacy/{slug}  { uid }  links a pre-sign-in leaderboard name (textdb)
                    to the account that claimed it, so old teams stay put.
   ================================================================ */

const V = "12.19.0";
const BASE = `https://www.gstatic.com/firebasejs/${V}`;

let fb = null;          // { auth, db, a: auth module, f: firestore module }
const EMAIL_KEY = "spinxi_signin_email";

export async function start(config, onChange) {
  const [{ initializeApp }, a, f] = await Promise.all([
    import(`${BASE}/firebase-app.js`),
    import(`${BASE}/firebase-auth.js`),
    import(`${BASE}/firebase-firestore-lite.js`),
  ]);
  const { emulator, ...appConfig } = config;
  const app = initializeApp(appConfig);
  const auth = a.getAuth(app);
  const db = f.getFirestore(app);
  if (emulator) {
    a.connectAuthEmulator(auth, emulator.auth, { disableWarnings: true });
    const [host, port] = emulator.firestore.split(":");
    f.connectFirestoreEmulator(db, host, Number(port));
  }
  fb = { auth, db, a, f };

  // arriving from a sign-in email
  if (a.isSignInWithEmailLink(auth, location.href)) {
    let email = localStorage.getItem(EMAIL_KEY);
    if (!email) email = prompt("Confirm your email address to finish signing in");
    if (email) {
      try {
        await a.signInWithEmailLink(auth, email.trim(), location.href);
        localStorage.removeItem(EMAIL_KEY);
      } catch (e) {
        console.warn("email link sign-in failed", e);
        alert("That sign-in link has expired or was already used. Ask for a new one.");
      }
    }
    history.replaceState(null, "", location.pathname);
  }

  await new Promise((resolve) => {
    let first = true;
    a.onAuthStateChanged(auth, (user) => {
      onChange(user ? userInfo(user) : null);
      if (first) { first = false; resolve(); }
    });
  });
}

function userInfo(u) {
  return { uid: u.uid, email: u.email || "", displayName: u.displayName || "" };
}

export function currentUser() {
  const u = fb?.auth.currentUser;
  return u ? userInfo(u) : null;
}

export async function signInGoogle() {
  const provider = new fb.a.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  await fb.a.signInWithPopup(fb.auth, provider);
}

export async function sendEmailLink(email) {
  await fb.a.sendSignInLinkToEmail(fb.auth, email, {
    url: location.origin + location.pathname,
    handleCodeInApp: true,
  });
  localStorage.setItem(EMAIL_KEY, email);
}

export async function signOut() {
  await fb.a.signOut(fb.auth);
}

function playerRef(uid) { return fb.f.doc(fb.db, "players", uid); }

export async function getProfile(uid = currentUser()?.uid) {
  if (!uid) return null;
  const snap = await fb.f.getDoc(playerRef(uid));
  return snap.exists() ? readPlayer(uid, snap.data()) : null;
}

export async function saveName(name) {
  const user = currentUser();
  if (!user) throw new Error("not signed in");
  await fb.f.setDoc(playerRef(user.uid),
    { name, updated: fb.f.serverTimestamp() }, { merge: true });
}

// add one team; the server stamps the time. Re-sending an entry that is
// already stored is a no-op.
export async function submitEntry(entry) {
  const user = currentUser();
  if (!user) throw new Error("not signed in");
  const ref = playerRef(user.uid);
  const snap = await fb.f.getDoc(ref);
  if (!snap.exists()) throw new Error("profile missing");   // saveName() first
  if (snap.data().entries?.[entry.id]) return;
  const value = {
    comp: entry.comp,
    label: entry.label || "",
    gw: entry.gw,
    formation: entry.formation,
    picks: entry.picks,
    captain: entry.captain ?? null,
    at: fb.f.serverTimestamp(),
  };
  await fb.f.updateDoc(ref, new fb.f.FieldPath("entries", entry.id), value,
    "last", entry.id, "updated", fb.f.serverTimestamp());
}

// link an old leaderboard name (textdb slug) to this account; first claim wins
export async function claimLegacy(slug) {
  const user = currentUser();
  if (!user || !slug) return false;
  const ref = fb.f.doc(fb.db, "legacy", slug);
  const snap = await fb.f.getDoc(ref);
  if (snap.exists()) return snap.data().uid === user.uid;
  try {
    await fb.f.setDoc(ref, { uid: user.uid });
    return true;
  } catch (e) {
    console.warn("legacy claim failed", e);
    return false;
  }
}

function readPlayer(uid, data) {
  const entries = Object.entries(data.entries || {}).map(([id, e]) => ({
    id,
    comp: e.comp,
    label: e.label,
    gw: e.gw,
    formation: e.formation,
    picks: e.picks,
    captain: e.captain,
    ts: e.at?.toMillis ? e.at.toMillis() : 0,
  }));
  return { uid, name: data.name || "Player", entries };
}

// every signed-in player and their teams, plus who claimed which old name
export async function loadBoard() {
  const [players, legacy] = await Promise.all([
    fb.f.getDocs(fb.f.collection(fb.db, "players")),
    fb.f.getDocs(fb.f.collection(fb.db, "legacy")),
  ]);
  const claims = {};
  legacy.forEach((d) => { claims[d.id] = d.data().uid; });
  return {
    players: players.docs.map((d) => readPlayer(d.id, d.data())),
    claims,
  };
}
