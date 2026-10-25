import { useState } from 'react';
import { Check, CircleAlert, RefreshCw, Trash2 } from 'lucide-react';
import { supabase } from './lib/supabase';

type Preview = { applicationCount: number; heldApplicationCount: number; auditCount: number; heldAuditCount: number };

export function RetentionManagement() {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function run(action: 'preview' | 'execute') {
    if (!supabase) return;
    setBusy(true); setError(''); setMessage('');
    const { data, error: invokeError } = await supabase.functions.invoke('retention-management', {
      body: action === 'preview' ? { action } : { action, confirmation },
    });
    setBusy(false);
    if (invokeError || data?.error) { setError(data?.error || 'The retention request failed.'); return; }
    if (action === 'preview') {
      setPreview(data as Preview);
      setMessage('Preview complete. No records were changed.');
    } else {
      setPreview(null); setConfirmation('');
      setMessage('Cleanup complete: ' + data.applicationsDeleted + ' applications/CVs and ' + data.auditDeleted + ' audit entries deleted. ' + data.applicationsFailed + ' applications need administrator review.');
    }
  }

  return <section className="dashboard-panel retention-panel">
    <div className="dashboard-panel-heading"><div><h2>Data retention</h2><p>Review records that have passed the approved retention periods.</p></div><button className="dashboard-refresh" onClick={() => void run('preview')} disabled={busy} aria-label="Preview expired records"><RefreshCw size={17}/></button></div>
    <div className="retention-content">
      <div className="retention-rules"><h3>Retention rules</h3><ul><li>Unsuccessful or withdrawn applications and CVs: 12 months after the final decision.</li><li>Staff access audit entries: 24 months after the event.</li><li>Successful candidates, active applications, and applications on legal hold are excluded.</li><li>Contact email copies are handled separately in Zoho Mail.</li></ul></div>
      {preview && <div className="retention-preview" role="status"><strong>Eligible for deletion</strong><span>{preview.applicationCount} application records and CVs</span><span>{preview.auditCount} staff audit entries</span><span>{preview.heldApplicationCount} applications currently on legal hold</span><span>{preview.heldAuditCount} audit entries currently on legal hold</span></div>}
      {message && <div className="dashboard-notice" role="status"><Check size={17}/>{message}</div>}
      {error && <div className="dashboard-alert" role="alert"><CircleAlert size={17}/>{error}</div>}
      <div className="retention-danger"><h3>Delete eligible records</h3><p>This permanently deletes matching application records and CV files, plus expired staff audit entries. CV files are removed from private storage before their application record. The operation processes up to 100 applications per run; preview and run it again if more remain.</p><label>Type <b>DELETE EXPIRED RECORDS</b> to confirm<input value={confirmation} onChange={event => setConfirmation(event.target.value)} autoComplete="off"/></label><button className="btn danger-button" onClick={() => void run('execute')} disabled={busy || confirmation !== 'DELETE EXPIRED RECORDS'}><Trash2 size={15}/>{busy ? 'Processing…' : 'Delete expired records'}</button></div>
      <p className="retention-footnote">Run the preview monthly and review any legal holds before confirming. The system returns aggregate counts only. Failed CV deletions are left for retry and review.</p>
    </div>
  </section>;
}

export function RetentionHoldControl({ application, onUpdated }: {
  application: { id: string; retention_hold: boolean; retention_hold_reason: string };
  onUpdated: (hold: boolean, reason: string) => void;
}) {
  const [reason, setReason] = useState(application.retention_hold_reason || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function update(action: 'set_hold' | 'clear_hold') {
    if (!supabase) return;
    setBusy(true); setError('');
    const { data, error: invokeError } = await supabase.functions.invoke('retention-management', {
      body: { action, applicationId: application.id, reason },
    });
    setBusy(false);
    if (invokeError || data?.error) { setError(data?.error || 'The legal hold could not be updated.'); return; }
    const hold = action === 'set_hold';
    onUpdated(hold, hold ? reason.trim() : '');
  }
  return <section className="retention-hold-control">
    <h3>Retention hold</h3><p>Use a hold when a legal claim, investigation, or other documented reason requires this application to be kept beyond its normal expiry.</p>
    {application.retention_hold && <p className="retention-held"><b>On hold:</b> {application.retention_hold_reason}</p>}
    {!application.retention_hold && <label>Reason for hold<textarea rows={2} maxLength={500} value={reason} onChange={event => setReason(event.target.value)} placeholder="Record the reason without adding unnecessary personal details."/></label>}
    {error && <p className="retention-error" role="alert">{error}</p>}
    <div className="dashboard-form-actions">{application.retention_hold ? <button className="btn darkoutline" onClick={() => void update('clear_hold')} disabled={busy}>{busy ? 'Updating…' : 'Clear hold'}</button> : <button className="btn darkoutline" onClick={() => void update('set_hold')} disabled={busy || !reason.trim()}>{busy ? 'Updating…' : 'Place application on hold'}</button>}</div>
  </section>;
}
