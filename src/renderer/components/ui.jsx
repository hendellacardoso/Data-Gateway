import { useEffect } from 'react';
import Icon from './Icon.jsx';

export function Button({ variant, size, icon, loading, children, className = '', ...props }) {
  const cls = ['btn', variant && `btn-${variant}`, size && `btn-${size}`, !children && icon && 'btn-icon', className].filter(Boolean).join(' ');
  return (
    <button type="button" className={cls} disabled={loading || props.disabled} {...props}>
      {loading ? <span className="spinner" /> : icon ? <Icon name={icon} /> : null}
      {children}
    </button>
  );
}

export function Card({ title, actions, children, className = '', bodyClass = 'card-body', noBody }) {
  return (
    <div className={'card ' + className}>
      {(title || actions) && (
        <div className="card-header">
          {typeof title === 'string' ? <h3>{title}</h3> : title}
          {actions && <div className="row">{actions}</div>}
        </div>
      )}
      {noBody ? children : <div className={bodyClass}>{children}</div>}
    </div>
  );
}

export function PageHeader({ title, subtitle, children }) {
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {children && <div className="page-actions">{children}</div>}
    </div>
  );
}

export function Field({ label, hint, error, children, className = '' }) {
  return (
    <div className={'field ' + className}>
      {label && <label>{label}</label>}
      {children}
      {hint && !error && <span className="hint">{hint}</span>}
      {error && <span className="error">{error}</span>}
    </div>
  );
}

export function Input({ className = '', ...props }) {
  return <input className={'input ' + className} {...props} value={props.value ?? ''} />;
}

export function Select({ options, className = '', placeholder, ...props }) {
  return (
    <select className={'select ' + className} {...props} value={props.value ?? ''}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={String(o.value)} value={o.value} disabled={o.disabled}>{o.label}</option>
      ))}
    </select>
  );
}

export function Checkbox({ label, checked, onChange, disabled, title }) {
  return (
    <label className={'check' + (disabled ? ' disabled' : '')} title={title}>
      <input type="checkbox" checked={!!checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

export function Switch({ checked, onChange, disabled }) {
  return (
    <label className="switch">
      <input type="checkbox" checked={!!checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span />
    </label>
  );
}

export function ToggleRow({ title, description, checked, onChange, disabled }) {
  return (
    <div className="toggle-row">
      <div>
        <div className="t">{title}</div>
        {description && <div className="d">{description}</div>}
      </div>
      <Switch checked={checked} onChange={onChange} disabled={disabled} />
    </div>
  );
}

export function Badge({ tone, children }) {
  return <span className={'badge ' + (tone || '')}>{children}</span>;
}

export function Method({ m }) {
  return <span className={'method ' + m}>{m}</span>;
}

export function Alert({ tone = 'info', title, children }) {
  return (
    <div className={'alert ' + tone}>
      <Icon name={tone === 'success' ? 'check' : tone === 'danger' ? 'alert' : 'alert'} size={18} />
      <div>
        {title && <div className="bold">{title}</div>}
        {children}
      </div>
    </div>
  );
}

export function ErrorAlert({ error }) {
  if (!error) return null;
  return (
    <Alert tone="danger" title={error.message}>
      {error.details && error.details.length > 1 && (
        <ul>{error.details.map((d, i) => <li key={i}>{d}</li>)}</ul>
      )}
    </Alert>
  );
}

export function Modal({ title, onClose, children, footer, size }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose && onClose()}>
      <div className={'modal ' + (size || '')} role="dialog" aria-modal="true">
        <div className="modal-header">
          <h3>{title}</h3>
          {onClose && <Button variant="ghost" icon="x" onClick={onClose} aria-label="Fechar" />}
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}

export function Empty({ icon = 'database', title, children }) {
  return (
    <div className="empty">
      <Icon name={icon} />
      <h4>{title}</h4>
      <div className="small">{children}</div>
    </div>
  );
}

export function Loading({ text = 'Carregando…' }) {
  return <div className="loading-block"><span className="spinner" /> {text}</div>;
}

export function Pagination({ page, pageSize, total, onChange }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="pagination">
      <span>{total.toLocaleString('pt-BR')} registro(s)</span>
      <div className="row">
        <Button size="sm" disabled={page <= 1} onClick={() => onChange(page - 1)}>Anterior</Button>
        <span>Página {page} de {pages}</span>
        <Button size="sm" disabled={page >= pages} onClick={() => onChange(page + 1)}>Próxima</Button>
      </div>
    </div>
  );
}

export function CopyButton({ text, label = 'Copiar' }) {
  return (
    <Button size="sm" icon="copy" onClick={() => navigator.clipboard.writeText(text)}>{label}</Button>
  );
}
