import { Routes, Route } from 'react-router-dom';
import AdminApp from './AdminApp.jsx';
import { PublicPortal } from './portal/PublicPortal.jsx';

export default function App() {
  return (
    <Routes>
      <Route path="/portal/*" element={<PublicPortal />} />
      <Route path="/*" element={<AdminApp />} />
    </Routes>
  );
}
