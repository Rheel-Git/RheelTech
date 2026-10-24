import {useEffect, useState} from 'react';
import type {FormEvent} from 'react';
import type {Session} from '@supabase/supabase-js';
import {ArrowRight, ShieldCheck} from 'lucide-react';
import {Link} from 'react-router-dom';
import {supabase, supabaseConfigured} from './lib/supabase';
import CareersDashboard from './CareersDashboard';

type StaffRole = 'admin' | 'recruiter';
type AccessState = 'checking' | 'authorized' | 'denied' | 'error';

export default function Admin(){
  const [session,setSession]=useState<Session|null>(null);
  const [authReady,setAuthReady]=useState(false);
  const [accessState,setAccessState]=useState<AccessState>('checking');
  const [role,setRole]=useState<StaffRole|null>(null);
  const [email,setEmail]=useState('');
  const [password,setPassword]=useState('');
  const [newPassword,setNewPassword]=useState('');
  const [busy,setBusy]=useState(false);
  const [recoveryMode,setRecoveryMode]=useState(false);
  const [message,setMessage]=useState('');

  useEffect(()=>{
    if(!supabase){setAuthReady(true);return;}
    const {data:{subscription}}=supabase.auth.onAuthStateChange((event,nextSession)=>{
      setSession(nextSession);
      setAuthReady(true);
      setRecoveryMode(event==='PASSWORD_RECOVERY'||window.location.hash.includes('type=invite'));
      setMessage('');
    });
    if(window.location.hash.includes('type=invite'))setRecoveryMode(true);
    void supabase.auth.getSession().then(({data,error})=>{
      if(!error)setSession(data.session);
      setAuthReady(true);
    });
    return()=>subscription.unsubscribe();
  },[]);

  useEffect(()=>{
    if(!supabase||!authReady||!session){setRole(null);setAccessState('checking');return;}
    let active=true;
    setAccessState('checking');
    void supabase.from('admin_profiles').select('role,is_active').eq('user_id',session.user.id).maybeSingle().then(({data,error})=>{
      if(!active)return;
      if(error){setAccessState('error');return;}
      if(data?.is_active===true&&(data.role==='admin'||data.role==='recruiter')){
        setRole(data.role);
        setAccessState('authorized');
      }else{
        setRole(null);
        setAccessState('denied');
      }
    });
    return()=>{active=false;};
  },[authReady,session]);

  async function login(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    if(!supabase)return;
    setBusy(true);setMessage('');
    const {error}=await supabase.auth.signInWithPassword({email:email.trim(),password});
    if(error)setMessage('Unable to sign in. Check your details and try again.');
    setBusy(false);
  }

  async function resetPassword(){
    if(!supabase)return;
    if(!email.trim()){setMessage('Enter your staff email address first.');return;}
    setBusy(true);setMessage('');
    const {error}=await supabase.auth.resetPasswordForEmail(email.trim(),{redirectTo:`${window.location.origin}/admin`});
    setMessage(error?'Password reset could not be started.':'If an account exists for that address, a reset email has been sent.');
    setBusy(false);
  }

  async function updatePassword(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    if(!supabase)return;
    setBusy(true);setMessage('');
    const {error}=await supabase.auth.updateUser({password:newPassword});
    setBusy(false);
    if(error){setMessage('Password could not be updated. Please request another reset link.');return;}
    window.history.replaceState({},document.title,window.location.pathname);
    setRecoveryMode(false);setNewPassword('');
    setMessage('Password updated. Your staff access is being checked.');
  }

  async function signOut(){
    if(!supabase)return;
    await supabase.auth.signOut();
    setRole(null);setAccessState('checking');setRecoveryMode(false);
  }

  if(!supabaseConfigured)return <main className="adminlogin"><Link className="brand" to="/"><b>R</b><span>RHEELTECH<small>STAFF ACCESS</small></span></Link><h1>Staff login</h1><p>The staging sign-in is not configured. Add the staging Supabase URL and public key to the Vercel Preview environment.</p><Link to="/">← Back to website</Link></main>;

  if(!authReady||(session&&accessState==='checking'))return <main className="adminlogin" aria-live="polite"><ShieldCheck/><h1>Checking staff access</h1><p>Please wait while we verify your sign-in.</p></main>;

  if(recoveryMode)return <main className="adminlogin"><Link className="brand" to="/"><b>R</b><span>RHEELTECH<small>STAFF ACCESS</small></span></Link><section className="login"><div className="eyebrow"><i/>ACCOUNT SECURITY</div><h1>Choose a new password</h1><form onSubmit={updatePassword}><label>New password<input type="password" autoComplete="new-password" minLength={8} value={newPassword} onChange={event=>setNewPassword(event.target.value)} required/></label><button className="btn" disabled={busy}>{busy?'Updating…':'Update password'}<ArrowRight size={15}/></button>{message&&<p role="status">{message}</p>}</form></section></main>;

  if(session&&accessState==='denied')return <main className="adminlogin"><Link className="brand" to="/"><b>R</b><span>RHEELTECH<small>STAFF ACCESS</small></span></Link><section className="login"><div className="eyebrow"><i/>ACCESS RESTRICTED</div><h1>This account has no staff access</h1><p>Only accounts listed in RheelTech’s recruitment staff profiles can open this portal.</p><button className="btn" onClick={signOut}>Sign out</button></section></main>;

  if(session&&accessState==='error')return <main className="adminlogin"><Link className="brand" to="/"><b>R</b><span>RHEELTECH<small>STAFF ACCESS</small></span></Link><section className="login"><div className="eyebrow"><i/>ACCESS CHECK</div><h1>We could not verify staff access</h1><p>Please try again in a moment. The portal stays locked until your staff profile is confirmed.</p><button className="btn" onClick={()=>setSession({...session})}>Try again</button><button className="reset" onClick={signOut}>Sign out</button></section></main>;

  if(session&&accessState==='authorized'&&role)return <CareersDashboard role={role} onSignOut={()=>{void signOut();}}/>;

  return <main className="adminlogin"><Link className="brand" to="/"><b>R</b><span>RHEELTECH<small>STAFF ACCESS</small></span></Link><section className="login"><div className="eyebrow"><i/>SECURE STAFF ACCESS</div><h1>Sign in to the careers portal</h1><p>Use the account provided by a RheelTech administrator.</p><form onSubmit={login}><label>Work email<input type="email" autoComplete="username" value={email} onChange={event=>setEmail(event.target.value)} required/></label><label>Password<input type="password" autoComplete="current-password" value={password} onChange={event=>setPassword(event.target.value)} required/></label><button className="btn" disabled={busy}>{busy?'Signing in…':'Sign in'}<ArrowRight size={15}/></button><button type="button" className="reset" onClick={resetPassword} disabled={busy}>Reset password</button>{message&&<p role="status">{message}</p>}</form></section><Link className="admin-back" to="/">← Back to RheelTech website</Link></main>;
}
