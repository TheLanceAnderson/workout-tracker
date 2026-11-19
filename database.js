
const DB_NAME = "WorkoutTrackerDB";
const DB_VERSION = 1;
const BACKUP_FORMAT_VERSION = 1;

let databasePromise = null;

function openDatabase() {
  if (databasePromise) return databasePromise;

  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      if (!db.objectStoreNames.contains("workouts")) {
        const store = db.createObjectStore("workouts", {
          keyPath: "id"
        });

        store.createIndex("date", "date");
      }

      if (!db.objectStoreNames.contains("activeWorkout")) {
        db.createObjectStore("activeWorkout", {
          keyPath: "id"
        });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      databasePromise = null;
      reject(request.error);
    };
  });

  return databasePromise;
}

async function saveWorkout(workout) {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction("workouts", "readwrite");
    transaction.objectStore("workouts").put(workout);

    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

async function getWorkouts() {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction("workouts", "readonly");
    const request = transaction.objectStore("workouts").getAll();

    request.onsuccess = () => {
      const workouts = request.result.sort(
        (a, b) => new Date(b.date) - new Date(a.date)
      );
      resolve(workouts);
    };

    request.onerror = () => reject(request.error);
  });
}

async function saveActiveWorkout(workout) {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction("activeWorkout", "readwrite");
    transaction.objectStore("activeWorkout").put({
      ...workout,
      id: "current"
    });

    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

async function getActiveWorkout() {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction("activeWorkout", "readonly");
    const request =
      transaction.objectStore("activeWorkout").get("current");

    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

async function clearActiveWorkout() {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction("activeWorkout", "readwrite");
    transaction.objectStore("activeWorkout").delete("current");

    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

async function getPersonalBest() {
  const workouts = await getWorkouts();

  const completed = workouts.filter(
    workout => workout.completed === true
  );

  return completed.length
    ? Math.max(...completed.map(workout => workout.totalLaps))
    : null;
}
