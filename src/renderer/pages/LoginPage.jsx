import { useState } from 'react';
import Icon from '../components/Icon.jsx';
import { Button, ErrorAlert, Field, Input } from '../components/ui.jsx';
import { useApp } from '../stores/AppContext.jsx';

export default function LoginPage() {
  const { login } = useApp();
  const [usuario, setUsuario] = useState('');
  const [senha, setSenha] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(usuario, senha);
    } catch (err) {
      setError(err);
      setSenha('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-screen">
      <form className="auth-card" onSubmit={submit}>
        <div className="brand"><div className="brand-logo" style={{ color: '#fff' }}><Icon name="database" size={17} /></div>Data Gateway</div>
        <h2>Entrar no painel</h2>
        <p>Informe suas credenciais de administrador.</p>
        {error && <div className="mb-2"><ErrorAlert error={error} /></div>}
        <Field label="Usuário">
          <Input autoFocus value={usuario} onChange={(e) => setUsuario(e.target.value)} autoComplete="username" />
        </Field>
        <Field label="Senha">
          <Input type="password" value={senha} onChange={(e) => setSenha(e.target.value)} autoComplete="current-password" />
        </Field>
        <Button type="submit" variant="primary" loading={busy} disabled={!usuario || !senha} style={{ width: '100%' }}>Entrar</Button>
      </form>
    </div>
  );
}
