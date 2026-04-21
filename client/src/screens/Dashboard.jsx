import { Routes, Route } from 'react-router-dom';
import { AdminShell } from '../layout/AdminShell.jsx';
import { DashboardHome } from '../pages/DashboardHome.jsx';
import { PaymentsPlaceholder } from '../pages/PaymentsPlaceholder.jsx';
import { PackagesPage } from '../pages/PackagesPage.jsx';
import { HotspotPanel } from '../components/HotspotPanel.jsx';
import { PppoePanel } from '../components/PppoePanel.jsx';
import { RemoteAccessPanel } from '../components/RemoteAccessPanel.jsx';
import { MessagesPage } from '../pages/MessagesPage.jsx';
import { RoutersPanel } from '../components/RoutersPanel.jsx';
import { CustomersPage } from '../pages/CustomersPage.jsx';
import { ActiveUsersPage } from '../pages/ActiveUsersPage.jsx';
import { SuperAdminOrganizationsPage } from '../pages/SuperAdminOrganizationsPage.jsx';
import { SuperAdminOrgAdminsPage } from '../pages/SuperAdminOrgAdminsPage.jsx';
import { SuperAdminEmailTemplatesPage } from '../pages/SuperAdminEmailTemplatesPage.jsx';
import { OrganizationSettingsPage } from '../pages/OrganizationSettingsPage.jsx';
import { SuperAdminGate } from '../components/SuperAdminGate.jsx';

export function Dashboard({ onSignOut }) {
  return (
    <Routes>
      <Route path="/" element={<AdminShell onSignOut={onSignOut} />}>
        <Route index element={<DashboardHome />} />
        <Route path="org/settings" element={<OrganizationSettingsPage />} />
        <Route path="users/customers" element={<CustomersPage />} />
        <Route path="users/active" element={<ActiveUsersPage />} />
        <Route path="finance/packages" element={<PackagesPage />} />
        <Route path="hotspot" element={<HotspotPanel />} />
        <Route path="finance/pppoe" element={<PppoePanel />} />
        <Route path="users/remote-access" element={<RemoteAccessPanel />} />
        <Route path="finance/payments" element={<PaymentsPlaceholder />} />
        <Route path="finance/messages" element={<MessagesPage />} />
        <Route path="devices/mikrotik" element={<RoutersPanel />} />
        <Route
          path="super/organizations"
          element={
            <SuperAdminGate>
              <SuperAdminOrganizationsPage />
            </SuperAdminGate>
          }
        />
        <Route
          path="super/organizations/:orgId/admins"
          element={
            <SuperAdminGate>
              <SuperAdminOrgAdminsPage />
            </SuperAdminGate>
          }
        />
        <Route
          path="super/email-templates"
          element={
            <SuperAdminGate>
              <SuperAdminEmailTemplatesPage />
            </SuperAdminGate>
          }
        />
      </Route>
    </Routes>
  );
}
