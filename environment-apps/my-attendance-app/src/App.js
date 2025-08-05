import React, { useState, useEffect } from 'react';
// Make sure to install firebase: npm install firebase
import { initializeApp } from "firebase/app";
import { 
  getAuth, 
  onAuthStateChanged, 
  signInWithEmailAndPassword, 
  signOut,
  createUserWithEmailAndPassword
} from "firebase/auth";
import { 
  getFirestore, 
  doc, 
  getDoc, 
  setDoc,
  collection,
  query,
  where,
  getDocs,
  orderBy,
  limit,
  deleteDoc,
  updateDoc
} from "firebase/firestore";


// --- Firebase Configuration ---
// Reads all Firebase config from secure environment variables
const firebaseConfig = {
  apiKey: process.env.REACT_APP_FIREBASE_API_KEY,
  authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID,
  storageBucket: process.env.REACT_APP_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.REACT_APP_FIREBASE_APP_ID,
  measurementId: process.env.REACT_APP_FIREBASE_MEASUREMENT_ID
};

// --- App Configuration ---
const OFFICE_COORDINATES = { latitude: -6.3020, longitude: 106.6520 };
const ALLOWED_RADIUS_METERS = 50;
// Reads the allowed IPs from the secure environment variable.
const ALLOWED_IPS = process.env.REACT_APP_ALLOWED_IPS ? process.env.REACT_APP_ALLOWED_IPS.split(',') : [];
const IPQUALITYSCORE_API_KEY = process.env.REACT_APP_IPQUALITYSCORE_API_KEY; 

// --- Initialize Firebase ---
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);


// --- Main App Component ---
export default function App() {
  const [user, setUser] = useState(null);
  const [userData, setUserData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (authUser) => {
      if (authUser) {
        const userDocRef = doc(db, "users", authUser.uid);
        const userDocSnap = await getDoc(userDocRef);
        if (userDocSnap.exists()) {
          setUserData({ uid: authUser.uid, ...userDocSnap.data() });
        }
        setUser(authUser);
      } else {
        setUser(null);
        setUserData(null);
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const handleLogout = async () => {
    await signOut(auth);
  };
  
  if (loading) {
    return <div className="bg-gray-100 min-h-screen flex items-center justify-center"><p>Loading...</p></div>;
  }

  if (user && userData) {
    if (userData.role === 'admin') {
        return <AdminDashboard user={userData} onLogout={handleLogout} />;
    }
    return <VerificationDashboard user={userData} onLogout={handleLogout} />;
  }
  
  return <LoginPage />;
}


// --- Page Components ---

function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (err) {
      setError('Failed to sign in. Please check your email and password.');
      console.error(err);
    }
  };

  return (
    <div className="bg-gray-100 min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-white rounded-xl shadow-lg p-8">
        <h1 className="text-3xl font-bold text-center text-gray-800 mb-2">Attendance Login</h1>
        <p className="text-center text-gray-500 mb-6">Use your registered email and password.</p>
        <form onSubmit={handleLogin}>
          <div className="mb-4">
            <label className="block text-gray-700 text-sm font-bold mb-2" htmlFor="email">Email</label>
            <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500" placeholder="e.g., elvan@example.com" />
          </div>
          <div className="mb-6">
            <label className="block text-gray-700 text-sm font-bold mb-2" htmlFor="password">Password</label>
            <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500" placeholder="******************" />
          </div>
          {error && <p className="text-red-500 text-xs italic mb-4">{error}</p>}
          <button type="submit" className="w-full bg-indigo-600 text-white font-bold py-3 px-4 rounded-lg hover:bg-indigo-700 transition duration-300">Sign In</button>
        </form>
      </div>
    </div>
  );
}

function VerificationDashboard({ user, onLogout }) {
    const [isProcessing, setIsProcessing] = useState(false);
    const [status, setStatus] = useState('checking'); // Initial state
    const [lastCheckIn, setLastCheckIn] = useState(null);
    const [verificationStatus, setVerificationStatus] = useState({
        geo: { state: 'idle', message: '' },
        ip: { state: 'idle', message: '' },
        vpn: { state: 'idle', message: '' },
        final: { state: 'idle', message: 'Your status will appear here.' },
    });

    useEffect(() => {
        const getLatestLog = async () => {
            const logId = `${user.uid}_${new Date().toISOString().split('T')[0]}`;
            const logRef = doc(db, "logs", logId);
            const logSnap = await getDoc(logRef);

            if (logSnap.exists()) {
                const latestLog = logSnap.data();
                setStatus(latestLog.status);
                setLastCheckIn(latestLog.checkInTime.toDate());
            } else {
                setStatus('Checked Out');
            }
        };
        getLatestLog();
    }, [user.uid]);

    const handleCheckIn = async () => {
        setIsProcessing(true);
        setVerificationStatus({
            geo: { state: 'pending', message: 'Checking...' },
            ip: { state: 'pending', message: 'Waiting...' },
            vpn: { state: 'pending', message: 'Waiting...' },
            final: { state: 'idle', message: '' },
        });

        const result = await runVerificationChecks(setVerificationStatus);

        if (result.success) {
            try {
                const checkInTime = new Date();
                const logData = { userId: user.uid, userName: user.name, status: 'Checked In', checkInTime, checkOutTime: null, verification: result.proof };
                const logId = `${user.uid}_${checkInTime.toISOString().split('T')[0]}`;
                await setDoc(doc(db, "logs", logId), logData);
                setStatus('Checked In');
                setLastCheckIn(checkInTime);
                setVerificationStatus(prev => ({ ...prev, final: { state: 'success', message: '✅ Check-in successful & logged!' } }));
            } catch (dbError) {
                setVerificationStatus(prev => ({ ...prev, final: { state: 'fail', message: `❌ Check-in failed to save: ${dbError.message}` } }));
            }
        } else {
            setVerificationStatus(prev => ({ ...prev, final: { state: 'fail', message: `❌ Check-in Denied: ${result.reasons.join(', ')}` } }));
        }
        setIsProcessing(false);
    };
    
    const handleCheckOut = async () => {
        setIsProcessing(true);
        const settingsRef = doc(db, "settings", "config");
        const settingsSnap = await getDoc(settingsRef);
        const settings = settingsSnap.exists() ? settingsSnap.data() : { checkOutTime: "17:00" };

        const now = new Date();
        const [hour, minute] = settings.checkOutTime.split(':');
        if (now.getHours() < parseInt(hour) || (now.getHours() === parseInt(hour) && now.getMinutes() < parseInt(minute))) {
            alert(`You can only check out after ${settings.checkOutTime}.`);
            setIsProcessing(false);
            return;
        }

        try {
            const checkOutTime = new Date();
            const logId = `${user.uid}_${checkOutTime.toISOString().split('T')[0]}`;
            const logRef = doc(db, "logs", logId);
            await updateDoc(logRef, { status: 'Checked Out', checkOutTime });
            setStatus('Checked Out');
            setVerificationStatus({ geo: { state: 'idle', message: '' }, ip: { state: 'idle', message: '' }, vpn: { state: 'idle', message: '' }, final: { state: 'idle', message: 'Checked out successfully!' } });
        } catch (error) {
            alert(`Check-out failed: ${error.message}`);
        }
        setIsProcessing(false);
    };

    return (
        <div className="bg-gray-100 min-h-screen">
            <header className="bg-white shadow-md p-4 flex justify-between items-center">
                <h1 className="text-xl font-bold text-indigo-600">Employee Dashboard</h1>
                <div>
                    <span className="text-gray-700 mr-4">Welcome, {user.name}</span>
                    <button onClick={onLogout} className="text-sm font-semibold text-red-600 hover:underline">Logout</button>
                </div>
            </header>
            <main className="p-8 flex items-center justify-center" style={{ minHeight: '80vh' }}>
                <div className="w-full max-w-md mx-auto bg-white rounded-xl shadow-lg p-8 text-center">
                    <h2 className="text-2xl font-bold text-gray-800 mb-2">Attendance Status</h2>
                    
                    {status === 'checking' ? (
                        <p className="text-gray-500 mb-6">Loading status...</p>
                    ) : (
                        <>
                            <p className="text-gray-500 mb-6">Your current status is: <span className={`font-bold ${status === 'Checked In' ? 'text-green-500' : 'text-red-500'}`}>{` ${status}`}</span></p>
                            {lastCheckIn && status === 'Checked In' && <p className="text-sm text-gray-500 mb-6">Last Check In: {lastCheckIn.toLocaleString()}</p>}
                        </>
                    )}
                    
                    {status === 'Checked Out' && (
                         <button onClick={handleCheckIn} disabled={isProcessing} className="w-full bg-indigo-600 text-white font-bold py-3 px-4 rounded-lg hover:bg-indigo-700 disabled:bg-gray-400">
                            {isProcessing ? 'Verifying...' : 'Verify & Check In'}
                        </button>
                    )}
                    {status === 'Checked In' && (
                        <button onClick={handleCheckOut} disabled={isProcessing} className="w-full bg-green-600 text-white font-bold py-3 px-4 rounded-lg hover:bg-green-700 disabled:bg-gray-400">
                            {isProcessing ? 'Processing...' : 'Check Out'}
                        </button>
                    )}

                    <div className="mt-6 p-4 bg-gray-50 rounded-lg min-h-[180px]">
                        {verificationStatus.final.state === 'idle' && verificationStatus.geo.state === 'idle' && <p className="text-gray-600 text-center">{verificationStatus.final.message}</p>}
                        {verificationStatus.geo.state !== 'idle' && <StatusItem label="Geolocation" state={verificationStatus.geo.state} message={verificationStatus.geo.message} />}
                        {verificationStatus.ip.state !== 'idle' && <StatusItem label="Network IP" state={verificationStatus.ip.state} message={verificationStatus.ip.message} />}
                        {verificationStatus.vpn.state !== 'idle' && <StatusItem label="VPN/Proxy Check" state={verificationStatus.vpn.state} message={verificationStatus.vpn.message} />}
                        {verificationStatus.final.state !== 'idle' && (
                            <div className={`text-center font-bold pt-4 mt-2 ${verificationStatus.final.state === 'success' ? 'text-green-700' : 'text-red-700'}`}>
                                {verificationStatus.final.message}
                            </div>
                        )}
                    </div>
                </div>
            </main>
        </div>
    );
}

function AdminDashboard({ user, onLogout }) {
  const [employeeData, setEmployeeData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState({ 
      checkInStart: '07:00', 
      checkInEnd: '11:00', 
      checkOutTime: '17:00', 
      autoCheckOutTime: '20:00',
      allowedDays: { mon: true, tue: true, wed: true, thu: true, fri: true, sat: false, sun: false } 
  });
  
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState('');

  const fetchEmployeeData = async () => {
      setLoading(true);
      const usersRef = collection(db, "users");
      const qUsers = query(usersRef, where("role", "==", "employee"));
      const usersSnapshot = await getDocs(qUsers);
      const employees = usersSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

      const today = new Date();
      today.setHours(0,0,0,0);
      const logsRef = collection(db, "logs");
      const qLogs = query(logsRef, where("checkInTime", ">=", today));
      const logsSnapshot = await getDocs(qLogs);
      
      const todaysLogs = {};
      logsSnapshot.forEach(doc => {
          const log = doc.data();
          if (!todaysLogs[log.userId] || log.checkInTime.toDate() > todaysLogs[log.userId].checkInTime.toDate()) {
             todaysLogs[log.userId] = log;
          }
      });

      const combinedData = employees.map(emp => {
          const log = todaysLogs[emp.id];
          return { id: emp.id, name: emp.name, status: log ? log.status : 'Checked Out', lastCheckIn: log ? log.checkInTime.toDate() : null };
      });
      
      setEmployeeData(combinedData);
      setLoading(false);
  };

  useEffect(() => {
    fetchEmployeeData();
    const fetchSettings = async () => {
        const settingsRef = doc(db, "settings", "config");
        const settingsSnap = await getDoc(settingsRef);
        if (settingsSnap.exists()) {
            setSettings(prev => ({ ...prev, ...settingsSnap.data() }));
        }
    };
    fetchSettings();
  }, []);

  const handleAddUser = async (e) => {
    e.preventDefault();
    setError('');
    if (!newName || !newEmail || !newPassword) { setError('All fields are required.'); return; }
    if (newPassword.length < 6) { setError('Password must be at least 6 characters long.'); return; }
    try {
        const tempApp = initializeApp(firebaseConfig, `Secondary-${Date.now()}`);
        const tempAuth = getAuth(tempApp);
        const userCredential = await createUserWithEmailAndPassword(tempAuth, newEmail, newPassword);
        const newUser = userCredential.user;
        await setDoc(doc(db, "users", newUser.uid), { name: newName, email: newEmail, role: 'employee' });
        setNewName(''); setNewEmail(''); setNewPassword('');
        await fetchEmployeeData();
    } catch (err) {
        if (err.code === 'auth/email-already-in-use') { setError('This email address is already in use.'); }
        else if (err.code === 'auth/invalid-email') { setError('The email address is not valid.'); }
        else { setError('Failed to create user. Please try again.'); }
    }
  };

  const handleRemoveUser = async (employeeId) => {
    if (window.confirm("Are you sure you want to remove this employee's record?")) {
        try {
            await deleteDoc(doc(db, "users", employeeId));
            await fetchEmployeeData();
        } catch (err) {
            alert(`Error removing user record: ${err.message}`);
        }
    }
  };

  const handleSettingsChange = (e) => {
      const { name, value, type, checked } = e.target;
      if (name === 'allowedDays') {
          setSettings(prev => ({ ...prev, allowedDays: { ...prev.allowedDays, [value]: checked } }));
      } else {
          setSettings(prev => ({ ...prev, [name]: value }));
      }
  };

  const handleSaveSettings = async () => {
      const settingsRef = doc(db, "settings", "config");
      try {
          await setDoc(settingsRef, settings, { merge: true });
          alert("Settings saved successfully!");
      } catch (err) {
          alert(`Failed to save settings: ${err.message}`);
      }
  };

  return (
    <div className="bg-gray-100 min-h-screen">
      <header className="bg-white shadow-md p-4 flex justify-between items-center">
        <h1 className="text-xl font-bold text-indigo-600">Admin Dashboard</h1>
        <div>
          <span className="text-gray-700 mr-4">Welcome, {user.name}</span>
          <button onClick={onLogout} className="text-sm font-semibold text-red-600 hover:underline">Logout</button>
        </div>
      </header>
      <main className="p-8">
        {/* Add User Form */}
        <div className="mb-8 bg-white p-6 rounded-xl shadow-lg">
            <h3 className="text-xl font-bold text-gray-800 mb-4">Add New Employee</h3>
            <form onSubmit={handleAddUser} className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
                <div><label className="block text-sm font-medium text-gray-700">Full Name</label><input type="text" value={newName} onChange={e => setNewName(e.target.value)} className="mt-1 block w-full px-3 py-2 border rounded-md" /></div>
                <div><label className="block text-sm font-medium text-gray-700">Email</label><input type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)} className="mt-1 block w-full px-3 py-2 border rounded-md" /></div>
                <div><label className="block text-sm font-medium text-gray-700">Password</label><input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} className="mt-1 block w-full px-3 py-2 border rounded-md" /></div>
                <div><button type="submit" className="w-full bg-indigo-600 text-white font-bold py-2 px-4 rounded-lg hover:bg-indigo-700">Add Employee</button></div>
            </form>
            {error && <p className="text-red-500 text-xs mt-2">{error}</p>}
        </div>

        {/* Settings Panel */}
        <div className="mb-8 bg-white p-6 rounded-xl shadow-lg">
            <h3 className="text-xl font-bold text-gray-800 mb-4">Attendance Settings</h3>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
                <div><label className="block text-sm font-medium text-gray-700">Check-in Start Time</label><input type="time" name="checkInStart" value={settings.checkInStart} onChange={handleSettingsChange} className="mt-1 block w-full px-3 py-2 border rounded-md" /></div>
                <div><label className="block text-sm font-medium text-gray-700">Check-in End Time</label><input type="time" name="checkInEnd" value={settings.checkInEnd} onChange={handleSettingsChange} className="mt-1 block w-full px-3 py-2 border rounded-md" /></div>
                <div><label className="block text-sm font-medium text-gray-700">Earliest Check-out Time</label><input type="time" name="checkOutTime" value={settings.checkOutTime} onChange={handleSettingsChange} className="mt-1 block w-full px-3 py-2 border rounded-md" /></div>
                <div><label className="block text-sm font-medium text-gray-700">Auto Check-out Time</label><input type="time" name="autoCheckOutTime" value={settings.autoCheckOutTime} onChange={handleSettingsChange} className="mt-1 block w-full px-3 py-2 border rounded-md" /></div>
            </div>
            <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700">Allowed Check-in Days</label>
                <div className="mt-2 flex flex-wrap gap-4">
                    {Object.keys(settings.allowedDays).map(day => (
                        <label key={day} className="flex items-center">
                            <input type="checkbox" name="allowedDays" value={day} checked={settings.allowedDays[day]} onChange={handleSettingsChange} className="h-4 w-4 text-indigo-600 border-gray-300 rounded" />
                            <span className="ml-2 text-sm text-gray-900 capitalize">{day}</span>
                        </label>
                    ))}
                </div>
            </div>
            <button onClick={handleSaveSettings} className="bg-green-600 text-white font-bold py-2 px-4 rounded-lg hover:bg-green-700">Save Settings</button>
        </div>

        <h2 className="text-2xl font-bold text-gray-800 mb-4">Employee Status Overview</h2>
        <div className="bg-white rounded-xl shadow-lg overflow-hidden">
          {loading ? <p className="p-4">Loading employee data...</p> : (
            <table className="min-w-full">
                <thead className="bg-gray-50">
                <tr>
                    <th className="py-3 px-6 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Employee</th>
                    <th className="py-3 px-6 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                    <th className="py-3 px-6 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Last Check-in</th>
                    <th className="py-3 px-6 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                {employeeData.map(employee => (
                    <tr key={employee.id}>
                    <td className="py-4 px-6 whitespace-nowrap">{employee.name}</td>
                    <td className="py-4 px-6 whitespace-nowrap">
                        <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${employee.status === 'Checked In' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>{employee.status}</span>
                    </td>
                    <td className="py-4 px-6 whitespace-nowrap text-sm text-gray-500">{employee.lastCheckIn ? new Date(employee.lastCheckIn).toLocaleString() : 'N/A'}</td>
                    <td className="py-4 px-6 whitespace-nowrap">
                        <button onClick={() => handleRemoveUser(employee.id)} className="text-red-600 hover:text-red-900 text-sm font-semibold">Remove</button>
                    </td>
                    </tr>
                ))}
                </tbody>
            </table>
          )}
        </div>
      </main>
    </div>
  );
}


// --- Status Item Component ---
function StatusItem({ label, state, message }) {
    const stateClasses = {
        idle: { dot: 'dot-pending', text: 'text-gray-500' },
        pending: { dot: 'dot-pending', text: 'text-gray-500' },
        success: { dot: 'dot-success', text: 'text-green-600' },
        fail: { dot: 'dot-fail', text: 'text-red-600' },
    };
    const classes = stateClasses[state] || stateClasses.idle;

    return (
        <div className="status-item">
            <span><span className={`dot ${classes.dot}`}></span>{label}</span>
            <span className={`${classes.text} font-semibold`}>{message}</span>
        </div>
    );
}


// --- Verification Logic & Helper Functions ---

async function runVerificationChecks(setStatus) {
    let isLocationOk = false;
    let isIpOk = false;
    let isVpnOk = false;
    const reasons = [];
    let proof = {};

    // First, check if check-in is allowed at this time
    const settingsRef = doc(db, "settings", "config");
    const settingsSnap = await getDoc(settingsRef);
    const settings = settingsSnap.exists() ? settingsSnap.data() : { checkInStart: '07:00', checkInEnd: '11:00', allowedDays: { mon: true, tue: true, wed: true, thu: true, fri: true, sat: false, sun: false } };
    
    const now = new Date();
    const dayName = now.toLocaleDateString('en-US', { weekday: 'short' }).toLowerCase();
    
    const timeToMinutes = (timeStr) => {
        const [hours, minutes] = timeStr.split(':').map(Number);
        return hours * 60 + minutes;
    };
    const currentTimeInMinutes = now.getHours() * 60 + now.getMinutes();
    const startTimeInMinutes = timeToMinutes(settings.checkInStart);
    const endTimeInMinutes = timeToMinutes(settings.checkInEnd);

    let isTimeAllowed = false;
    if (endTimeInMinutes < startTimeInMinutes) { 
        isTimeAllowed = currentTimeInMinutes >= startTimeInMinutes || currentTimeInMinutes <= endTimeInMinutes;
    } else {
        isTimeAllowed = currentTimeInMinutes >= startTimeInMinutes && currentTimeInMinutes <= endTimeInMinutes;
    }

    if (!settings.allowedDays[dayName]) {
        reasons.push("Check-in is not allowed today.");
    }
    if (!isTimeAllowed) {
        reasons.push(`Check-in is only allowed between ${settings.checkInStart} and ${settings.checkInEnd}.`);
    }

    if (reasons.length > 0) {
        return { success: false, reasons, proof };
    }


    // Geolocation Check
    try {
        const userCoords = await getGeolocation();
        const distance = getDistance(userCoords.latitude, userCoords.longitude, OFFICE_COORDINATES.latitude, OFFICE_COORDINATES.longitude);
        isLocationOk = distance <= ALLOWED_RADIUS_METERS;
        proof.geo = `${userCoords.latitude.toFixed(4)}, ${userCoords.longitude.toFixed(4)}`;
        setStatus(prev => ({ ...prev, geo: { state: isLocationOk ? 'success' : 'fail', message: `Distance: ${distance.toFixed(0)}m` } }));
        if (!isLocationOk) reasons.push('Out of range');
    } catch (error) {
        setStatus(prev => ({ ...prev, geo: { state: 'fail', message: error.message } }));
        reasons.push('Location failed');
    }

    // Network & VPN Check
    try {
        const ipInfo = await getIpInfo();
        proof.ip = ipInfo.ipAddress;
        isIpOk = ALLOWED_IPS.includes(ipInfo.ipAddress);
        setStatus(prev => ({ ...prev, ip: { state: isIpOk ? 'success' : 'fail', message: `Your IP: ${ipInfo.ipAddress}` } }));
        if (!isIpOk) reasons.push('Invalid network');

        isVpnOk = !ipInfo.isVpnOrProxy;
        setStatus(prev => ({ ...prev, vpn: { state: isVpnOk ? 'success' : 'fail', message: ipInfo.isVpnOrProxy ? 'Proxy Detected' : 'Connection OK' } }));
        if (!isVpnOk) reasons.push('VPN detected');
    } catch (error) {
        setStatus(prev => ({ ...prev, ip: { state: 'fail', message: 'Check Failed' }, vpn: { state: 'fail', message: 'Check Failed' } }));
        reasons.push('Network check failed');
    }

    return {
        success: isLocationOk && isIpOk && isVpnOk,
        reasons: reasons,
        proof: proof,
    };
}

async function getIpInfo() {
    if (IPGEOLOCATION_API_KEY === 'YOUR_IPGEOLOCATION_API_KEY') {
        throw new Error("ipgeolocation.io API key not set.");
    }
    try {
        const apiUrl = `https://api.ipgeolocation.io/ipgeo?apiKey=${IPGEOLOCATION_API_KEY}`;
        const response = await fetch(apiUrl);
        if (!response.ok) throw new Error('Could not connect to IP service.');
        const data = await response.json();
        if (data.message) {
            throw new Error(`IP Service Error: ${data.message}`);
        }
        return {
            ipAddress: data.ip,
            isVpnOrProxy: data.security ? data.security.is_vpn : false
        };
    } catch (error) {
        console.error("Could not fetch IP information:", error);
        throw new Error("Could not verify network connection.");
    }
}

function getGeolocation() {
    return new Promise((resolve, reject) => {
        if (!('geolocation' in navigator)) {
            return reject(new Error("Geolocation not supported."));
        }
        navigator.geolocation.getCurrentPosition(
            position => resolve(position.coords),
            error => {
                let msg = "Could not get location.";
                if(error.code === 1) msg = "Location access denied.";
                reject(new Error(msg));
            },
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
        );
    });
}

function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3;
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}
