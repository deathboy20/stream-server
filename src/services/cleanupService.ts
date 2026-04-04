import cron from 'node-cron';
import { db } from '../config/firebase';
import { collection, getDocs, deleteDoc, doc } from 'firebase/firestore';
import { Session } from '../types';

export const startCleanupJob = () => {
  cron.schedule('0 * * * *', async () => {
    console.log('Running cleanup job...');
    try {
      const now = Date.now();
      const sessionsRef = collection(db, 'sessions');
      const snapshot = await getDocs(sessionsRef);
      const deletions: Promise<void>[] = [];
      for (const docSnap of snapshot.docs) {
        const session = docSnap.data() as Session;
        if (session.expiresAt && session.expiresAt < now) {
          console.log(`Removing expired session: ${docSnap.id}`);
          deletions.push(deleteDoc(doc(db, 'sessions', docSnap.id)));
        }
      }
      await Promise.all(deletions);
    } catch (error) {
      console.error('Cleanup job failed:', error);
    }
  });
};
