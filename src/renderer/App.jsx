import { useEffect } from 'react';
import { HashRouter, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { AppProvider, useApp } from './stores/AppContext.jsx';
import { onGatewayEvent } from './services/api.js';
import { Loading } from './components/ui.jsx';
import MainLayout from './layouts/MainLayout.jsx';
import LoginPage from './pages/LoginPage.jsx';
import SetupPage from './pages/SetupPage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import BancosPage from './pages/BancosPage.jsx';
import StatusPage from './pages/StatusPage.jsx';
import EndpointsPage from './pages/EndpointsPage.jsx';
import WizardPage from './pages/wizard/WizardPage.jsx';
import TokensPage from './pages/TokensPage.jsx';
import DocsPage from './pages/DocsPage.jsx';
import TesterPage from './pages/TesterPage.jsx';
import TabelasPage from './pages/TabelasPage.jsx';
import CamposPage from './pages/CamposPage.jsx';
import RelacionamentosPage from './pages/RelacionamentosPage.jsx';
import UploadsPage from './pages/UploadsPage.jsx';
import LogsPage from './pages/LogsPage.jsx';
import AuditoriaPage from './pages/AuditoriaPage.jsx';
import UsuariosPage from './pages/UsuariosPage.jsx';
import ConfiguracoesPage from './pages/ConfiguracoesPage.jsx';
import SobrePage from './pages/SobrePage.jsx';
import ConsultasPage from './pages/consultas/ConsultasPage.jsx';
import ConsultaEditorPage from './pages/consultas/ConsultaEditorPage.jsx';

/** Navegação solicitada pelo menu do Tray. */
function TrayNavigation() {
  const navigate = useNavigate();
  useEffect(() => onGatewayEvent('navigate', (route) => navigate(route)), [navigate]);
  return null;
}

function Gate() {
  const { user, needsSetup } = useApp();
  if (user === undefined) return <div className="auth-screen"><Loading /></div>;
  if (needsSetup) return <SetupPage />;
  if (!user) return <LoginPage />;
  return (
    <>
      <TrayNavigation />
      <Routes>
        <Route element={<MainLayout />}>
          <Route index element={<DashboardPage />} />
          <Route path="conexoes/bancos" element={<BancosPage />} />
          <Route path="conexoes/status" element={<StatusPage />} />
          <Route path="apis/endpoints" element={<EndpointsPage />} />
          <Route path="apis/endpoints/novo" element={<WizardPage />} />
          <Route path="apis/endpoints/:id" element={<WizardPage />} />
          <Route path="apis/consultas" element={<ConsultasPage />} />
          <Route path="apis/consultas/nova" element={<ConsultaEditorPage key="nova" />} />
          <Route path="apis/consultas/:id" element={<ConsultaEditorPage />} />
          <Route path="apis/tokens" element={<TokensPage />} />
          <Route path="apis/documentacao" element={<DocsPage />} />
          <Route path="apis/testador" element={<TesterPage />} />
          <Route path="configuracao/tabelas" element={<TabelasPage />} />
          <Route path="configuracao/campos" element={<CamposPage />} />
          <Route path="configuracao/relacionamentos" element={<RelacionamentosPage />} />
          <Route path="configuracao/uploads" element={<UploadsPage />} />
          <Route path="monitoramento/logs" element={<LogsPage />} />
          <Route path="monitoramento/auditoria" element={<AuditoriaPage />} />
          <Route path="sistema/usuarios" element={<UsuariosPage />} />
          <Route path="sistema/configuracoes" element={<ConfiguracoesPage />} />
          <Route path="sistema/sobre" element={<SobrePage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </>
  );
}

export default function App() {
  return (
    <AppProvider>
      <HashRouter>
        <Gate />
      </HashRouter>
    </AppProvider>
  );
}
