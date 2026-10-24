import {useEffect, useMemo, useState} from 'react';
import {Check, CircleAlert, Clock3, KeyRound, Pencil, Plus, RefreshCw, Search, Shield, Trash2, UserRoundPlus, Users, X} from 'lucide-react';
import {supabase} from './lib/supabase';

type Role='admin'|'recruiter';
type Status='active'|'invited'|'deactivated';
type StaffUser={id:string;email:string;displayName:string;role:Role;status:Status;createdAt:string;lastSignInAt:string|null};
type AuditEvent={id:string;actor_user_id:string;actor_email:string;target_user_id:string;target_email:string;event_type:string;old_role:Role|null;new_role:Role|null;created_at:string};
type Draft={displayName:string;role:Role};
type PendingAction={kind:'deactivate'|'remove';user:StaffUser}|null;

const roleLabel=(role:Role)=>role==='admin'?'Administrator':'Recruitment Manager';
const dateLabel=(value:string|null)=>value?new Date(value).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'}):'Never';

export default function StaffManagement(){
  const [users,setUsers]=useState<StaffUser[]>([]);
  const [events,setEvents]=useState<AuditEvent[]>([]);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [busyUser,setBusyUser]=useState<string|null>(null);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [query,setQuery]=useState('');
  const [roleFilter,setRoleFilter]=useState<'all'|Role>('all');
  const [statusFilter,setStatusFilter]=useState<'all'|Status>('all');
  const [inviteOpen,setInviteOpen]=useState(false);
  const [invite,setInvite]=useState({displayName:'',email:'',role:'recruiter' as Role});
  const [editing,setEditing]=useState<StaffUser|null>(null);
  const [draft,setDraft]=useState<Draft>({displayName:'',role:'recruiter'});
  const [pending,setPending]=useState<PendingAction>(null);
  const [confirmEmail,setConfirmEmail]=useState('');
  const [showAudit,setShowAudit]=useState(false);

  async function call(action:string,payload:Record<string,unknown>={}){
    if(!supabase)throw new Error('Staff management is not configured.');
    const {data,error:invokeError}=await supabase.functions.invoke('staff-management',{body:{action,...payload}});
    if(invokeError){
      let safeMessage='The staff request could not be completed. Refresh and try again.';
      const context=(invokeError as {context?:unknown}).context;
      if(context instanceof Response){
        try{const responseBody=await context.clone().json();if(typeof responseBody?.error==='string')safeMessage=responseBody.error;}catch{/* Keep the safe fallback. */}
      }
      throw new Error(safeMessage);
    }
    if(data?.error)throw new Error(String(data.error));
    return data;
  }

  async function load(){
    setLoading(true);setError('');
    try{const data=await call('list');setUsers(data.users||[]);setEvents(data.audit||[]);}
    catch(reason){setError(reason instanceof Error?reason.message:'Staff users could not be loaded.');}
    finally{setLoading(false);}
  }

  useEffect(()=>{void load();},[]);
  const filtered=useMemo(()=>users.filter(user=>{
    const matchesQuery=`${user.displayName} ${user.email}`.toLowerCase().includes(query.trim().toLowerCase());
    return matchesQuery&&(roleFilter==='all'||user.role===roleFilter)&&(statusFilter==='all'||user.status===statusFilter);
  }),[users,query,roleFilter,statusFilter]);

  async function submitInvite(event:React.FormEvent<HTMLFormElement>){
    event.preventDefault();setBusy(true);setError('');setNotice('');
    try{const result=await call('invite',{display_name:invite.displayName,email:invite.email,role:invite.role});setNotice(result.message||'Invitation created.');setInvite({displayName:'',email:'',role:'recruiter'});setInviteOpen(false);await load();}
    catch(reason){setError(reason instanceof Error?reason.message:'The invitation could not be created.');}
    finally{setBusy(false);}
  }

  function startEdit(user:StaffUser){setEditing(user);setDraft({displayName:user.displayName,role:user.role});setError('');setNotice('');}
  async function saveEdit(event:React.FormEvent<HTMLFormElement>){
    event.preventDefault();if(!editing)return;setBusyUser(editing.id);setError('');setNotice('');
    try{await call('update',{user_id:editing.id,display_name:draft.displayName,role:draft.role});setNotice('Staff profile updated.');setEditing(null);await load();}
    catch(reason){setError(reason instanceof Error?reason.message:'The profile could not be updated.');}
    finally{setBusyUser(null);}
  }

  async function runAction(action:'deactivate'|'reactivate'|'remove'|'send_setup',user:StaffUser){
    setBusyUser(user.id);setError('');setNotice('');
    try{
      const payload:Record<string,unknown>={user_id:user.id};
      if(action==='remove')payload.confirm_email=confirmEmail;
      const result=await call(action,payload);setNotice(result.message|| (action==='reactivate'?'Staff access reactivated.':action==='deactivate'?'Staff access deactivated.':action==='remove'?'Staff account removed.':'Setup link sent.'));
      setPending(null);setConfirmEmail('');await load();
    }catch(reason){setError(reason instanceof Error?reason.message:'The staff action could not be completed.');}
    finally{setBusyUser(null);}
  }

  return <section className="dashboard-panel staff-management">
    <div className="dashboard-panel-heading"><div><h2>User management</h2><p>Manage authorised staff and review access changes.</p></div><div className="staff-heading-actions"><button className="dashboard-refresh" onClick={()=>void load()} disabled={loading} aria-label="Refresh staff users"><RefreshCw size={16}/></button><button className="btn" onClick={()=>{setInviteOpen(value=>!value);setError('');setNotice('');}}><UserRoundPlus size={16}/>{inviteOpen?'Close':'Invite user'}</button></div></div>
    <div className="staff-role-summary"><div><Shield size={17}/><span><b>Administrator</b>Manage users, roles, vacancies and applications.</span></div><div><Users size={17}/><span><b>Recruitment Manager</b>Manage vacancies and applications. Cannot manage users or assign roles.</span></div></div>
    {error&&<div className="dashboard-alert" role="alert"><CircleAlert size={17}/>{error}<button onClick={()=>setError('')} aria-label="Dismiss"><X size={15}/></button></div>}
    {notice&&<div className="dashboard-notice" role="status"><Check size={17}/>{notice}<button onClick={()=>setNotice('')} aria-label="Dismiss"><X size={15}/></button></div>}
    {inviteOpen&&<form className="dashboard-editor staff-editor" onSubmit={submitInvite}><div className="dashboard-editor-heading"><div><h3>Invite a staff user</h3><p>A password setup link will be emailed to this address.</p></div><button type="button" className="icon-button" onClick={()=>setInviteOpen(false)} aria-label="Close invitation form"><X size={17}/></button></div><div className="dashboard-form-grid"><label>Display name<input value={invite.displayName} onChange={event=>setInvite({...invite,displayName:event.target.value})} maxLength={120} required/></label><label>Work email<input type="email" value={invite.email} onChange={event=>setInvite({...invite,email:event.target.value})} maxLength={320} required/></label><label>Assigned role<select value={invite.role} onChange={event=>setInvite({...invite,role:event.target.value as Role})}><option value="recruiter">Recruitment Manager</option><option value="admin">Administrator</option></select><small>Only an administrator can assign the Administrator role.</small></label></div><div className="dashboard-form-actions"><button className="btn" disabled={busy}>{busy?'Preparing invitation…':'Create invitation'}<Plus size={15}/></button></div></form>}
    <div className="staff-filters"><label className="dashboard-search"><Search size={15}/><input aria-label="Search staff users" placeholder="Search by name or email" value={query} onChange={event=>setQuery(event.target.value)}/></label><label>Role<select value={roleFilter} onChange={event=>setRoleFilter(event.target.value as 'all'|Role)}><option value="all">All roles</option><option value="admin">Administrators</option><option value="recruiter">Recruitment Managers</option></select></label><label>Status<select value={statusFilter} onChange={event=>setStatusFilter(event.target.value as 'all'|Status)}><option value="all">All statuses</option><option value="active">Active</option><option value="invited">Invite pending</option><option value="deactivated">Deactivated</option></select></label><span>{filtered.length} users</span></div>
    {loading?<div className="dashboard-empty"><Clock3 size={24}/><p>Loading authorised users…</p></div>:filtered.length===0?<div className="dashboard-empty"><Users size={24}/><h3>{users.length?'No matching staff users':'No authorised users yet'}</h3><p>{users.length?'Change the search or filters.':'Invite a trusted colleague to the careers portal.'}</p></div>:<div className="dashboard-table-wrap"><table className="dashboard-table staff-table"><thead><tr><th>User</th><th>Role</th><th>Status</th><th>Created</th><th>Last sign-in</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{filtered.map(user=><tr key={user.id}><td><strong>{user.displayName||user.email}</strong>{user.displayName&&<small>{user.email}</small>}</td><td>{roleLabel(user.role)}</td><td><span className={`status-pill status-${user.status}`}>{user.status==='invited'?'Invite pending':user.status==='deactivated'?'Deactivated':'Active'}</span></td><td>{dateLabel(user.createdAt)}</td><td>{dateLabel(user.lastSignInAt)}</td><td><div className="row-actions"><button onClick={()=>startEdit(user)} aria-label={`Edit ${user.email}`} title="Edit"><Pencil size={15}/></button>{user.status==='invited'&&<button onClick={()=>void runAction('send_setup',user)} disabled={busyUser===user.id} aria-label={`Send setup link to ${user.email}`} title="Send setup link"><KeyRound size={15}/></button>}{user.status==='deactivated'?<button onClick={()=>void runAction('reactivate',user)} disabled={busyUser===user.id} aria-label={`Reactivate ${user.email}`} title="Reactivate"><RefreshCw size={15}/></button>:<button onClick={()=>setPending({kind:'deactivate',user})} disabled={busyUser===user.id} aria-label={`Deactivate ${user.email}`} title="Deactivate"><X size={15}/></button>}<button className="danger-icon" onClick={()=>{setConfirmEmail('');setPending({kind:'remove',user});}} disabled={busyUser===user.id} aria-label={`Remove ${user.email}`} title="Remove"><Trash2 size={15}/></button></div></td></tr>)}</tbody></table></div>}
    <div className="staff-audit-toggle"><button type="button" className="textlink" onClick={()=>setShowAudit(value=>!value)}>{showAudit?'Hide':'View'} recent access audit ({events.length})</button></div>
    {showAudit&&<div className="dashboard-table-wrap"><table className="dashboard-table staff-audit-table"><thead><tr><th>Event</th><th>Changed by</th><th>User</th><th>Role change</th><th>When</th></tr></thead><tbody>{events.map(event=><tr key={event.id}><td>{event.event_type.replaceAll('_',' ')}</td><td>{event.actor_email}</td><td>{event.target_email}</td><td>{event.old_role||event.new_role?`${event.old_role?roleLabel(event.old_role):'—'} → ${event.new_role?roleLabel(event.new_role):'—'}`:'—'}</td><td>{dateLabel(event.created_at)}</td></tr>)}</tbody></table>{events.length===0&&<div className="dashboard-empty">No staff access events have been recorded.</div>}</div>}
    {editing&&<div className="dashboard-modal-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget)setEditing(null);}}><section className="dashboard-modal" role="dialog" aria-modal="true" aria-labelledby="staff-edit-title"><div className="dashboard-modal-heading"><div><div className="eyebrow"><i/>STAFF PROFILE</div><h2 id="staff-edit-title">Edit user</h2><p>{editing.email}</p></div><button className="icon-button" onClick={()=>setEditing(null)} aria-label="Close"><X size={18}/></button></div><form onSubmit={saveEdit}><div className="dashboard-form-grid staff-modal-grid"><label>Display name<input value={draft.displayName} onChange={event=>setDraft({...draft,displayName:event.target.value})} maxLength={120} required/></label><label>Role<select value={draft.role} onChange={event=>setDraft({...draft,role:event.target.value as Role})}><option value="recruiter">Recruitment Manager</option><option value="admin">Administrator</option></select></label></div><p className="staff-role-hint">Role changes take effect through the database-backed staff access policy. The last active administrator cannot be demoted.</p><div className="dashboard-form-actions"><button type="button" className="btn darkoutline" onClick={()=>setEditing(null)} disabled={busyUser===editing.id}>Cancel</button><button className="btn" disabled={busyUser===editing.id}>{busyUser===editing.id?'Saving…':'Save changes'}</button></div></form></section></div>}
    {pending&&<div className="dashboard-modal-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget&&!busyUser){setPending(null);setConfirmEmail('');}}}><section className="dashboard-modal" role="alertdialog" aria-modal="true" aria-labelledby="staff-action-title"><div className="dashboard-modal-heading"><div><div className="eyebrow"><i/>CONFIRM ACCESS CHANGE</div><h2 id="staff-action-title">{pending.kind==='remove'?'Remove this staff account?':'Deactivate staff access?'}</h2><p>{pending.kind==='remove'?<>This permanently removes <strong>{pending.user.email}</strong> from Supabase Auth and staff access. Historical vacancies and applications will be kept.</>:<>This blocks <strong>{pending.user.email}</strong> from the careers portal and database. It can be reactivated later.</>}</p></div><button className="icon-button" onClick={()=>{setPending(null);setConfirmEmail('');}} disabled={Boolean(busyUser)} aria-label="Cancel"><X size={18}/></button></div>{pending.kind==='remove'&&<label className="staff-confirm-email">Type the staff email to confirm removal<input type="email" autoComplete="off" value={confirmEmail} onChange={event=>setConfirmEmail(event.target.value)} placeholder={pending.user.email}/></label>}<div className="dashboard-form-actions"><button className="btn darkoutline" onClick={()=>{setPending(null);setConfirmEmail('');}} disabled={Boolean(busyUser)}>Cancel</button><button className={`btn ${pending.kind==='remove'?'danger-button':''}`} disabled={Boolean(busyUser)||(pending.kind==='remove'&&confirmEmail.trim().toLowerCase()!==pending.user.email.toLowerCase())} onClick={()=>void runAction(pending.kind==='remove'?'remove':'deactivate',pending.user)}>{busyUser?'Working…':pending.kind==='remove'?'Remove account':'Deactivate access'}{pending.kind==='remove'&&<Trash2 size={15}/>}</button></div></section></div>}
  </section>;
}
