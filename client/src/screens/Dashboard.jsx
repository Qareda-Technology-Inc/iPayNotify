import { Routes, Route, Navigate } from 'react-router-dom';
import { AdminShell } from '../layout/AdminShell.jsx';
import { DashboardHome } from '../pages/DashboardHome.jsx';
import { PaymentsPage } from '../pages/PaymentsPage.jsx';
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
import { RoleGate } from '../components/RoleGate.jsx';
import { TicketSitesPage } from '../pages/tickets/TicketSitesPage.jsx';
import { TicketTypesPage } from '../pages/tickets/TicketTypesPage.jsx';
import { TicketIssuePage } from '../pages/tickets/TicketIssuePage.jsx';
import { TicketCollectionsPage } from '../pages/tickets/TicketCollectionsPage.jsx';
import { TicketReportsPage } from '../pages/tickets/TicketReportsPage.jsx';
import { MessageProvider } from '../messages/MessageProvider.jsx';

export function Dashboard({ onSignOut }) {
  return (
    <MessageProvider>
      <Routes>
        <Route path="/" element={<AdminShell onSignOut={onSignOut} />}>
        <Route
          index
          element={
            <RoleGate allow={['super_admin', 'org_admin', 'ticket_manager', 'org_staff']}>
              <DashboardHome />
            </RoleGate>
          }
        />
        <Route
          path="org/settings"
          element={
            <RoleGate allow={['super_admin', 'org_admin', 'org_staff']}>
              <OrganizationSettingsPage />
            </RoleGate>
          }
        />
        <Route
          path="users/customers"
          element={
            <RoleGate allow={['super_admin', 'org_admin', 'org_staff']}>
              <CustomersPage />
            </RoleGate>
          }
        />
        <Route
          path="users/active"
          element={
            <RoleGate allow={['super_admin', 'org_admin', 'org_staff']}>
              <ActiveUsersPage />
            </RoleGate>
          }
        />
        <Route path="tickets/sales" element={<Navigate to="/tickets/issue" replace />} />
        <Route
          path="tickets/sites"
          element={
            <RoleGate allow={['super_admin', 'org_admin', 'ticket_manager', 'org_staff']}>
              <TicketSitesPage />
            </RoleGate>
          }
        />
        <Route
          path="tickets/types"
          element={
            <RoleGate allow={['super_admin', 'org_admin', 'ticket_manager', 'org_staff']}>
              <TicketTypesPage />
            </RoleGate>
          }
        />
        <Route
          path="tickets/issue"
          element={
            <RoleGate allow={['super_admin', 'org_admin', 'ticket_manager', 'org_staff']}>
              <TicketIssuePage />
            </RoleGate>
          }
        />
        <Route
          path="tickets/collections"
          element={
            <RoleGate allow={['super_admin', 'org_admin', 'ticket_manager', 'org_staff']}>
              <TicketCollectionsPage />
            </RoleGate>
          }
        />
        <Route
          path="tickets/reports"
          element={
            <RoleGate allow={['super_admin', 'org_admin', 'ticket_manager', 'org_staff']}>
              <TicketReportsPage />
            </RoleGate>
          }
        />
        <Route
          path="finance/packages"
          element={
            <RoleGate allow={['super_admin', 'org_admin', 'org_staff']}>
              <PackagesPage />
            </RoleGate>
          }
        />
        <Route
          path="hotspot"
          element={
            <RoleGate allow={['super_admin', 'org_admin', 'org_staff']}>
              <HotspotPanel />
            </RoleGate>
          }
        />
        <Route
          path="finance/pppoe"
          element={
            <RoleGate allow={['super_admin', 'org_admin', 'org_staff']}>
              <PppoePanel />
            </RoleGate>
          }
        />
        <Route
          path="users/remote-access"
          element={
            <RoleGate allow={['super_admin', 'org_admin', 'org_staff']}>
              <RemoteAccessPanel />
            </RoleGate>
          }
        />
        <Route
          path="finance/payments"
          element={
            <RoleGate allow={['super_admin', 'org_admin', 'org_staff']}>
              <PaymentsPage />
            </RoleGate>
          }
        />
        <Route
          path="finance/messages"
          element={
            <RoleGate allow={['super_admin', 'org_admin', 'org_staff']}>
              <MessagesPage />
            </RoleGate>
          }
        />
        <Route
          path="devices/mikrotik"
          element={
            <RoleGate allow={['super_admin', 'org_admin', 'org_staff']}>
              <RoutersPanel />
            </RoleGate>
          }
        />
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
    </MessageProvider>
  );
}
