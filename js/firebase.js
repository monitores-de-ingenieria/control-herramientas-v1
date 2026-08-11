// js/firebase.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app-check.js";
import {
  getFirestore,
  collection,
  getDocs,
  getDoc,
  setDoc,
  addDoc,
  query,
  orderBy,
  serverTimestamp,
  where,
  updateDoc,
  doc,
  Timestamp,
  runTransaction
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDkxEHj-F2ST2_qWiFKe-ZYsEPRkIHs7zM",
  authDomain: "taller-maquina-herramienta.firebaseapp.com",
  projectId: "taller-maquina-herramienta",
  storageBucket: "taller-maquina-herramienta.firebasestorage.app",
  messagingSenderId: "764170192710",
  appId: "1:764170192710:web:459413da1ed0c41f4c0747",
  measurementId: "G-46C4BJ3PLY"
};

const app = initializeApp(firebaseConfig);

const appCheck = initializeAppCheck(app, {
  provider: new ReCaptchaEnterpriseProvider("6Le7KHQtAAAAAPVxDTA-r3SAIRFSPaBs4vQ0xPem"),
  isTokenAutoRefreshEnabled: true
});

const db = getFirestore(app);

// true porque ya tenemos credenciales reales
const firebaseConfigurado = true;

export {
  db,
  collection,
  getDocs,
  getDoc,
  setDoc,
  addDoc,
  query,
  orderBy,
  serverTimestamp,
  where,
  updateDoc,
  doc,
  Timestamp,
  runTransaction,
  firebaseConfigurado
};
