// firebase.js — Firebase init + Firestore exports
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.8.1/firebase-app.js";
import { getFirestore, doc, getDoc, setDoc, onSnapshot }
  from "https://www.gstatic.com/firebasejs/11.8.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBPplQt9hJDAvyD0Pm0iVudj9wXMnWOzHE",
  authDomain: "los-jueves-hay-dragones.firebaseapp.com",
  projectId: "los-jueves-hay-dragones",
  storageBucket: "los-jueves-hay-dragones.firebasestorage.app",
  messagingSenderId: "355740854962",
  appId: "1:355740854962:web:3afb8b063aa96cd54177ab"
};

const fbApp = initializeApp(firebaseConfig);
const db    = getFirestore(fbApp);

const LEGACY_STATE_DOC    = doc(db, 'campaign',  'state');
const CAMPAIGNS_INDEX_DOC = doc(db, 'app',        'campaigns');
const APP_USERS_DOC       = doc(db, 'app',        'users');

export { db, LEGACY_STATE_DOC, CAMPAIGNS_INDEX_DOC, APP_USERS_DOC, doc, getDoc, setDoc, onSnapshot };
