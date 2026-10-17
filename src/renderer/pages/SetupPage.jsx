import { useState } from 'react';
import Icon from '../components/Icon.jsx';
import { Alert, Button, ErrorAlert, Field, Input } from '../components/ui.jsx';
import { call } from '../services/api.js';
import { useApp } from '../stores/AppContext.jsx';

export default function SetupPage() {
  const { refreshAuth } = useApp();
  const [f, setF] = useState({ usuario: 'admin', senha: '', confirmar: '' });
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await call('auth.setup', f);
      setDone(true);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-screen">
      <form className="auth-card" onSubmit={submit}>
        <div className="brand"><div className="brand-logo" style={{ color: '#fff' }}><Icon name="database" size={17} /></div>Data Gateway</div>
        {done ? (
          <>
            <Alert tone="success" title="Administrador criado com sucesso.">Agora entre com o usuário e a senha definidos.</Alert>
            <Button variant="primary" className="mt-2" style={{ width: '100%' }} onClick={refreshAuth}>Ir para o login</Button>
          </>
        ) : (
          <>
            <h2>Bem-vindo ao Data Gateway</h2>
            <p>Crie o usuário administrador.</p>
            {error && <div className="mb-2"><ErrorAlert error={error} /></div>}
            <Field label="Usuário"><Input value={f.usuario} onChange={set('usuario')} autoComplete="username" /></Field>
            <Field label="Senha" hint="Mínimo de 8 caracteres, com letras e números.">
              <Input type="password" value={f.senha} onChange={set('senha')} autoComplete="new-password" autoFocus />
            </Field>
            <Field label="Confirmar senha"><Input type="password" value={f.confirmar} onChange={set('confirmar')} autoComplete="new-password" /></Field>
            <Button type="submit" variant="primary" loading={busy} style={{ width: '100%' }}>Criar administrador</Button>
          </>
        )}
      </form>
    </div>
  );
}
