import cron from 'node-cron';
import { db } from '../config/firebase';
import { collection, getDocs, deleteDoc, doc } from 'firebase/firestore';
import { Session } from '../types';

export const startCleanupJob = () => {
  // Run every hour
  cron.schedule('0 * * * *', async () => {
    console.log('Running cleanup job...');
    try {
      const now = Date.now();
      const sessionsRef = collection(db, 'sessions');
      const snapshot = await getDocs(sessionsRef);

      snapshot.forEach(async (docSnap) => {
        const session = docSnap.data() as Session;
        if (session.expiresAt && session.expiresAt < now) {
          console.log(`Removing expired session: ${docSnap.id}`);
          await deleteDoc(doc(db, 'sessions', docSnap.id));
        }
      });
    } catch (error) {
      console.error('Cleanup job failed:', error);
    }
  });
};
