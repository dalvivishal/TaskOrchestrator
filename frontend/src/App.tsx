import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Login from './Login';
import Dashboard from './Dashboard';
import JobDetail from './JobDetail';

function App() {
  const token = localStorage.getItem('access_token');

  return (
    <BrowserRouter>
      <div className="min-h-screen">
        <header className="bg-white shadow-sm border-b border-gray-200">
          <div className="max-w-7xl mx-auto px-4 py-4 sm:px-6 lg:px-8 flex justify-between items-center">
            <h1 className="text-xl font-bold text-blue-600">Task Orchestrator</h1>
            {token && (
              <button 
                onClick={() => { localStorage.removeItem('access_token'); window.location.href = '/login'; }}
                className="text-sm text-gray-500 hover:text-gray-900"
              >
                Logout
              </button>
            )}
          </div>
        </header>
        
        <main className="max-w-7xl mx-auto px-4 py-8 sm:px-6 lg:px-8">
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/dashboard" element={token ? <Dashboard /> : <Navigate to="/login" />} />
            <Route path="/jobs/:id" element={token ? <JobDetail /> : <Navigate to="/login" />} />
            <Route path="/" element={<Navigate to={token ? "/dashboard" : "/login"} />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}

export default App;
