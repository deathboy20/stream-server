import 'dotenv/config';
import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import admin from 'firebase-admin';

const firebaseConfig = {
  apiKey: "AIzaSyDkH3rGQ0UoH2a_fNFO7HaP2oOpazyH7rU",
  authDomain: "fieldcom-8159b.firebaseapp.com",
  projectId: "fieldcom-8159b",
  storageBucket: "fieldcom-8159b.appspot.com",
  messagingSenderId: "548978360911",
  appId: "1:548978360911:web:0e05e3d0220d623edc203a",
  measurementId: "G-MN9QG97XJE"
};

const clientApp = initializeApp(firebaseConfig);
export const db = getFirestore(clientApp);

const initAdmin = () => {
  if (admin.apps.length > 0) {
    return admin.app();
  }
  return admin.initializeApp({
    projectId: firebaseConfig.projectId
  });
};

const adminApp = initAdmin();
export const adminAuth = admin.auth(adminApp);

export const initFirebase = async () => {
  console.log('Firebase Admin initialized in projectId mode');
};
