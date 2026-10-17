import {useCallback, useEffect, useMemo, useState} from 'react';
import type {FormEvent} from 'react';
import {ArrowUpRight, BriefcaseBusiness, Check, CircleAlert, Download, FileText, Pencil, Plus, RefreshCw, Search, ShieldCheck, Users, X} from 'lucide-react';
import {Link} from 'react-router-dom';
import {supabase} from './lib/supabase';

type StaffRole='admin'|'recruiter';
type JobStatus='draft'|'published'|'closed'|'archived';
type ApplicationStatus='new'|'under_review'|'shortlisted'|'interview'|'offered'|'rejected'|'withdrawn';
type Job={id:string;title:string;slug:string;department:string;employment_type:string;work_arrangement:'on-site'|'hybrid'|'remote';location:string;summary:string;description:string;responsibilities:string[];requirements:string[];salary_range:string|null;status:JobStatus;published_at:string|null;closing_at:string|null;created_at:string;updated_at:string};
type Application={id:string;job_id:string;full_name:string;email:string;phone:string;location:string;experience_summary:string;cover_letter:string;cv_storage_path:string;status:ApplicationStatus;consent_at:string;internal_notes:string;created_at:string;jobs:{title:string;slug:string}|null};
type JobDraft={title:string;slug:string;department:string;employment_type:string;work_arrangement:Job['work_arrangement'];location:string;summary:string;description:string;responsibilities:string;requirements:string;salary_range:string;status:JobStatus;closing_at:string};
const statuses:ApplicationStatus[]=['new','under_review','shortlisted','interview','offered','rejected','withdrawn'];
const emptyDraft:JobDraft={title:'',slug:'',department:'',employment_type:'Full-time',work_arrangement:'on-site',location:'',summary:'',description:'',responsibilities:'',requirements:'',salary_range:'',status:'draft',closing_at:''};
const jobFields='id,title,slug,department,employment_type,work_arrangement,location,summary,description,responsibilities,requirements,salary_range,status,published_at,closing_at,created_at,updated_at';
const appFields='id,job_id,full_name,email,phone,location,experience_summary,cover_letter,cv_storage_path,status,consent_at,internal_notes,created_at,jobs(title,slug)';
const slugify=(value:string)=>value.toLowerCase().trim().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
const titleCase=(value:string)=>value.replaceAll('_',' ').replace(/\b\w/g,c=>c.toUpperCase());
const localDate=(value:string|null)=>value?new Date(value).toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'}):'No closing date';

export default function CareersDashboard({role,onSignOut}:{role:StaffRole;onSignOut:()=>void}){
  const [tab,setTab]=useState<'jobs'|'applications'>('jobs');
  const [jobs,setJobs]=useState<Job[]>([]);
  const [applications,setApplications]=useState<Application[]>([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [query,setQuery]=useState('');
  const [editor,setEditor]=useState<JobDraft|null>(null);
  const [editingId,setEditingId]=useState<string|null>(null);
  const [selectedApplication,setSelectedApplication]=useState<Application|null>(null);
  const [saving,setSaving]=useState(false);
  const [busyId,setBusyId]=useState<string|null>(null);

  const loadData=useCallback(async()=>{
    if(!supabase)return;
    setLoading(true);setError('');
    const [jobResult,applicationResult]=await Promise.all([
      supabase.from('jobs').select(jobFields).order('created_at',{ascending:false}),
      supabase.from('applications').select(appFields).order('created_at',{ascending:false}),
    ]);
    if(jobResult.error){setError('Vacancies could not be loaded. Please check your staff access and try again.');setJobs([]);}
    else setJobs((jobResult.data||[]) as unknown as Job[]);
    if(applicationResult.error){setError(current=>current||'Applications could not be loaded. Please check your staff access and try again.');setApplications([]);}
    else setApplications((applicationResult.data||[]) as unknown as Application[]);
    setLoading(false);
  },[]);

  useEffect(()=>{void loadData();},[loadData]);

  const counts=useMemo(()=>({total:jobs.length,published:jobs.filter(job=>job.status==='published').length,drafts:jobs.filter(job=>job.status==='draft').length,applications:applications.length,newApps:applications.filter(app=>app.status==='new').length}),[jobs,applications]);
  const filteredJobs=jobs.filter(job=>`${job.title} ${job.department} ${job.location} ${job.status}`.toLowerCase().includes(query.toLowerCase()));
  const filteredApplications=applications.filter(app=>`${app.full_name} ${app.email} ${app.jobs?.title||''} ${app.status}`.toLowerCase().includes(query.toLowerCase()));

  function startNewJob(){setEditingId(null);setEditor(emptyDraft);setError('');setNotice('');}
  function startEditJob(job:Job){setEditingId(job.id);setEditor({title:job.title,slug:job.slug,department:job.department,employment_type:job.employment_type,work_arrangement:job.work_arrangement,location:job.location,summary:job.summary,description:job.description,responsibilities:(job.responsibilities||[]).join('\n'),requirements:(job.requirements||[]).join('\n'),salary_range:job.salary_range||'',status:job.status,closing_at:job.closing_at?job.closing_at.slice(0,10):''});setError('');setNotice('');}
  function updateDraft<K extends keyof JobDraft>(key:K,value:JobDraft[K]){setEditor(current=>current?{...current,[key]:value}:current);}

  async function saveJob(event:FormEvent<HTMLFormElement>){
    event.preventDefault();if(!supabase||!editor)return;
    setSaving(true);setError('');setNotice('');
    const previous=editingId?jobs.find(job=>job.id===editingId):undefined;
    const payload={title:editor.title.trim(),slug:(editor.slug.trim()||slugify(editor.title)).toLowerCase(),department:editor.department.trim(),employment_type:editor.employment_type.trim(),work_arrangement:editor.work_arrangement,location:editor.location.trim(),summary:editor.summary.trim(),description:editor.description.trim(),responsibilities:editor.responsibilities.split('\n').map(v=>v.trim()).filter(Boolean),requirements:editor.requirements.split('\n').map(v=>v.trim()).filter(Boolean),salary_range:editor.salary_range.trim()||null,status:editor.status,published_at:editor.status==='published'?(previous?.published_at||new Date().toISOString()):previous?.published_at||null,closing_at:editor.closing_at?new Date(`${editor.closing_at}T23:59:59`).toISOString():null,created_by:editingId?undefined:(await supabase.auth.getUser()).data.user?.id};
    const result=editingId?await supabase.from('jobs').update(payload).eq('id',editingId):await supabase.from('jobs').insert(payload);
    setSaving(false);
    if(result.error){setError('The vacancy could not be saved. Check the required fields, unique URL, and your staff permissions.');return;}
    setEditor(null);setEditingId(null);setNotice(editingId?'Vacancy updated.':'Vacancy created.');await loadData();
  }

  async function updateApplication(app:Application,changes:Partial<Pick<Application,'status'|'internal_notes'>>){
    if(!supabase)return;setBusyId(app.id);setError('');setNotice('');
    const{error:updateError}=await supabase.from('applications').update(changes).eq('id',app.id);
    setBusyId(null);
    if(updateError){setError('The application update could not be saved. Check your staff permissions and try again.');return;}
    setApplications(current=>current.map(item=>item.id===app.id?{...item,...changes}:item));
    setSelectedApplication(current=>current?.id===app.id?{...current,...changes}:current);setNotice('Application updated.');
  }

  async function openCv(app:Application){
    if(!supabase)return;setBusyId(app.id);setError('');
    const{data,error:storageError}=await supabase.storage.from('private-cvs').createSignedUrl(app.cv_storage_path,60,{download:true});
    setBusyId(null);
    if(storageError||!data?.signedUrl){setError('The CV could not be opened. Your account may not have permission to access this file.');return;}
    window.open(data.signedUrl,'_blank','noopener,noreferrer');
  }

  return <div className="dashboard">
    <aside className="dashboard-sidebar">
      <Link className="brand invert" to="/"><b>R</b><span>RHEELTECH<small>CAREERS STAFF PORTAL</small></span></Link>
      <div className="dashboard-user"><span>Signed in as</span><strong>{role==='admin'?'Administrator':'Recruiter'}</strong></div>
      <nav aria-label="Careers management">
        <button className={tab==='jobs'?'selected':''} onClick={()=>{setTab('jobs');setSelectedApplication(null);setError('');}}><BriefcaseBusiness size={17}/> Vacancies <span>{counts.total}</span></button>
        <button className={tab==='applications'?'selected':''} onClick={()=>{setTab('applications');setEditor(null);setError('');}}><Users size={17}/> Applications <span>{counts.applications}</span></button>
      </nav>
      <div className="dashboard-sidebar-bottom"><Link to="/careers">View public careers page ↗</Link><button onClick={onSignOut}>Sign out</button></div>
    </aside>
    <main className="dashboard-main">
      <header className="dashboard-header"><div><div className="eyebrow"><i/>SECURE STAFF AREA</div><h1>Careers dashboard</h1><p>Manage vacancies and review candidate applications.</p></div><button className="dashboard-refresh" onClick={()=>void loadData()} disabled={loading} aria-label="Refresh dashboard"><RefreshCw size={17}/></button></header>
      <section className="dashboard-stats" aria-label="Careers summary">
        <article><span><BriefcaseBusiness size={17}/> Vacancies</span><strong>{loading?'—':counts.total}</strong></article>
        <article><span><Check size={17}/> Published</span><strong>{loading?'—':counts.published}</strong></article>
        <article><span><FileText size={17}/> Drafts</span><strong>{loading?'—':counts.drafts}</strong></article>
        <article><span><Users size={17}/> New applications</span><strong>{loading?'—':counts.newApps}</strong></article>
      </section>
      {error&&<div className="dashboard-alert" role="alert"><CircleAlert size={18}/>{error}<button onClick={()=>setError('')} aria-label="Dismiss"><X size={16}/></button></div>}
      {notice&&<div className="dashboard-notice" role="status"><Check size={17}/>{notice}<button onClick={()=>setNotice('')} aria-label="Dismiss"><X size={16}/></button></div>}

      {tab==='jobs'&&<section className="dashboard-panel">
        <div className="dashboard-panel-heading"><div><h2>Vacancies</h2><p>Create, update and publish job listings.</p></div><button className="btn" onClick={startNewJob}><Plus size={16}/> New vacancy</button></div>
        {editor&&<form className="dashboard-editor" onSubmit={saveJob}>
          <div className="dashboard-editor-heading"><h3>{editingId?'Edit vacancy':'Create vacancy'}</h3><button type="button" className="icon-button" onClick={()=>setEditor(null)} aria-label="Close"><X size={18}/></button></div>
          <div className="dashboard-form-grid">
            <label>Job title<input value={editor.title} onChange={e=>{updateDraft('title',e.target.value);if(!editingId)updateDraft('slug',slugify(e.target.value));}} required maxLength={180}/></label>
            <label>URL slug<input value={editor.slug} onChange={e=>updateDraft('slug',slugify(e.target.value))} required maxLength={180}/></label>
            <label>Department<input value={editor.department} onChange={e=>updateDraft('department',e.target.value)} required maxLength={120}/></label>
            <label>Employment type<input value={editor.employment_type} onChange={e=>updateDraft('employment_type',e.target.value)} required maxLength={80} placeholder="Full-time, Contract…"/></label>
            <label>Work arrangement<select value={editor.work_arrangement} onChange={e=>updateDraft('work_arrangement',e.target.value as Job['work_arrangement'])}><option value="on-site">On-site</option><option value="hybrid">Hybrid</option><option value="remote">Remote</option></select></label>
            <label>Location<input value={editor.location} onChange={e=>updateDraft('location',e.target.value)} required maxLength={160}/></label>
            <label>Salary range (optional)<input value={editor.salary_range} onChange={e=>updateDraft('salary_range',e.target.value)} maxLength={120}/></label>
            <label>Closing date (optional)<input type="date" value={editor.closing_at} onChange={e=>updateDraft('closing_at',e.target.value)}/></label>
            <label>Status<select value={editor.status} onChange={e=>updateDraft('status',e.target.value as JobStatus)}><option value="draft">Draft</option><option value="published">Published</option><option value="closed">Closed</option><option value="archived">Archived</option></select></label>
            <label className="full">Short summary<textarea value={editor.summary} onChange={e=>updateDraft('summary',e.target.value)} required maxLength={800} rows={2}/></label>
            <label className="full">Description<textarea value={editor.description} onChange={e=>updateDraft('description',e.target.value)} required rows={5}/></label>
            <label>Responsibilities <small>One item per line</small><textarea value={editor.responsibilities} onChange={e=>updateDraft('responsibilities',e.target.value)} rows={5}/></label>
            <label>Requirements <small>One item per line</small><textarea value={editor.requirements} onChange={e=>updateDraft('requirements',e.target.value)} rows={5}/></label>
          </div>
          <div className="dashboard-form-actions"><button type="button" className="btn darkoutline" onClick={()=>setEditor(null)}>Cancel</button><button className="btn" disabled={saving}>{saving?'Saving…':editingId?'Save changes':'Create vacancy'}</button></div>
        </form>}
        <div className="dashboard-table-tools"><label className="dashboard-search"><Search size={16}/><input placeholder="Search vacancies" value={query} onChange={e=>setQuery(e.target.value)}/></label><span>{filteredJobs.length} vacancies</span></div>
        {loading?<div className="dashboard-empty">Loading vacancies…</div>:filteredJobs.length===0?<div className="dashboard-empty"><BriefcaseBusiness size={25}/><h3>{query?'No matching vacancies':'No vacancies yet'}</h3><p>{query?'Try another search.':'Create your first vacancy to start receiving applications.'}</p>{!query&&<button className="btn" onClick={startNewJob}><Plus size={16}/> New vacancy</button>}</div>:<div className="dashboard-table-wrap"><table className="dashboard-table"><thead><tr><th>Role</th><th>Status</th><th>Applications</th><th>Closing date</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{filteredJobs.map(job=><tr key={job.id}><td><strong>{job.title}</strong><small>{job.department} · {job.location}</small></td><td><span className={`status-pill status-${job.status}`}>{titleCase(job.status)}</span></td><td>{applications.filter(app=>app.job_id===job.id).length}</td><td>{localDate(job.closing_at)}</td><td><div className="row-actions"><Link to={`/careers/${job.slug}`} target="_blank" aria-label={`View ${job.title} on public careers page`}><ArrowUpRight size={16}/></Link><button onClick={()=>startEditJob(job)} aria-label={`Edit ${job.title}`}><Pencil size={15}/></button></div></td></tr>)}</tbody></table></div>}
      </section>}

      {tab==='applications'&&<section className="dashboard-panel">
        <div className="dashboard-panel-heading"><div><h2>Applications</h2><p>Review candidates, update progress and access private CVs.</p></div></div>
        <div className="dashboard-table-tools"><label className="dashboard-search"><Search size={16}/><input placeholder="Search candidates or roles" value={query} onChange={e=>setQuery(e.target.value)}/></label><span>{filteredApplications.length} applications</span></div>
        {loading?<div className="dashboard-empty">Loading applications…</div>:filteredApplications.length===0?<div className="dashboard-empty"><Users size={25}/><h3>{query?'No matching applications':'No applications yet'}</h3><p>{query?'Try another search.':'Applications submitted through the public careers page will appear here.'}</p></div>:<div className="dashboard-table-wrap"><table className="dashboard-table"><thead><tr><th>Candidate</th><th>Vacancy</th><th>Status</th><th>Received</th><th><span className="sr-only">Details</span></th></tr></thead><tbody>{filteredApplications.map(app=><tr key={app.id}><td><strong>{app.full_name}</strong><small>{app.email}</small></td><td>{app.jobs?.title||'Vacancy'}</td><td><select className="status-select" value={app.status} onChange={e=>void updateApplication(app,{status:e.target.value as ApplicationStatus})} disabled={busyId===app.id} aria-label={`Application status for ${app.full_name}`}>{statuses.map(status=><option key={status} value={status}>{titleCase(status)}</option>)}</select></td><td>{localDate(app.created_at)}</td><td><button className="btn small darkoutline" onClick={()=>setSelectedApplication(app)}>Review</button></td></tr>)}</tbody></table></div>}
      </section>}
      {selectedApplication&&<div className="dashboard-modal-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget)setSelectedApplication(null);}}><section className="dashboard-modal" role="dialog" aria-modal="true" aria-labelledby="application-detail-title"><div className="dashboard-modal-heading"><div><div className="eyebrow"><i/>APPLICATION REVIEW</div><h2 id="application-detail-title">{selectedApplication.full_name}</h2><p>{selectedApplication.jobs?.title||'Vacancy'} · received {localDate(selectedApplication.created_at)}</p></div><button className="icon-button" onClick={()=>setSelectedApplication(null)} aria-label="Close application"><X size={20}/></button></div><div className="application-contact"><a href={`mailto:${selectedApplication.email}`}>{selectedApplication.email}</a><a href={`tel:${selectedApplication.phone}`}>{selectedApplication.phone}</a><span>{selectedApplication.location}</span></div><div className="application-copy"><h3>Experience</h3><p>{selectedApplication.experience_summary}</p><h3>Cover letter</h3><p>{selectedApplication.cover_letter}</p></div><label className="application-notes">Internal notes<textarea rows={4} value={selectedApplication.internal_notes||''} onChange={event=>setSelectedApplication({...selectedApplication,internal_notes:event.target.value})}/></label><div className="dashboard-form-actions"><button className="btn darkoutline" onClick={()=>void openCv(selectedApplication)} disabled={busyId===selectedApplication.id}><Download size={16}/>{busyId===selectedApplication.id?'Preparing CV…':'Download CV'}</button><button className="btn" onClick={()=>void updateApplication(selectedApplication,{internal_notes:selectedApplication.internal_notes||''})} disabled={busyId===selectedApplication.id}>{busyId===selectedApplication.id?'Saving…':'Save notes'}</button></div></section></div>}
      <footer className="dashboard-footer"><ShieldCheck size={15}/> Candidate details and CVs are available only to authorised recruitment staff.</footer>
    </main>
  </div>;
}
