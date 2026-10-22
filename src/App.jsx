// src/App.jsx
import { BrowserRouter, Link, Navigate, Route, Routes } from 'react-router-dom';
import { ChevronRight, LayoutDashboard, PackageCheck, Truck } from 'lucide-react';
import ProviderPage from './components/pages/ProviderPage';
import ReceiverPage from './components/pages/ReceiverPage';
import AdminPage from './components/pages/AdminPage';

const ROLES = [
  { to: '/provider', icon: Truck, title: 'Asset Provider', text: 'Send a machine to another plant', tone: 'primary' },
  { to: '/receiver', icon: PackageCheck, title: 'Asset Receiver', text: 'Review & accept an incoming machine', tone: 'success' },
  { to: '/admin', icon: LayoutDashboard, title: 'Admin', text: 'Dashboard of all transfers', tone: 'neutral' },
];

function Home() {
  return (
    <div className="home">
      <div className="home-hero">
        <div className="home-logo"><Truck size={26} /></div>
        <h1>Machine Asset Transfer</h1>
        <p>Inter-plant machine transfer, inspection &amp; approval</p>
      </div>
      <div className="role-list">
        {ROLES.map((r) => (
          <Link key={r.to} to={r.to} className={`role role-${r.tone}`}>
            <span className="role-icon"><r.icon size={22} /></span>
            <span className="role-text">
              <strong>{r.title}</strong>
              <small>{r.text}</small>
            </span>
            <ChevronRight size={20} className="role-go" />
          </Link>
        ))}
      </div>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/provider" element={<ProviderPage />} />
        <Route path="/receiver" element={<ReceiverPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
