import { useState } from 'react';

/** A factory-floor phone gets typed on with a thumb, half-looking at the
 * screen — being able to check what was actually typed matters more here
 * than it does on a desktop login form. Shared by Settings' own
 * change-password form and the admin reset-password flow. */
export function PasswordField({
  label,
  value,
  onChange,
  autoComplete,
}: {
  label: string;
  value: string;
  onChange(v: string): void;
  autoComplete: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div>
      <label className="field-label">{label}</label>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          className="input"
          style={{ flex: 1 }}
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
        />
        <button
          type="button"
          className="btn btn-small"
          style={{ flex: 'none' }}
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? 'Hide password' : 'Show password'}
        >
          {visible ? '🙈' : '👁'}
        </button>
      </div>
    </div>
  );
}
