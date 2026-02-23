import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth, signInAnonymously } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyDzXEFEPR5Qw6ZHUB7s7q_AS65P3qntQCM",
  authDomain: "stream-6c5bb.firebaseapp.com",
  projectId: "stream-6c5bb",
  storageBucket: "stream-6c5bb.firebasestorage.app",
  messagingSenderId: "934572124832",
  appId: "1:934572124832:web:ff543b81acf179155c77c5",
  measurementId: "G-MB0XJ68B98",
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);

export const initFirebase = async () => {
  try {
    const userCredential = await signInAnonymously(auth);
    console.log("Firebase: Signed in anonymously as", userCredential.user.uid);
  } catch (error) {
    console.error("Firebase: Error signing in anonymously", error);
  }
};
