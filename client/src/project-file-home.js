import { useEffect, useState } from 'react';
import { h } from './h.js';

export async function chooseProjectFile(call, onOpen) {
 const result = await call('projects_choose_file', { request: { action: 'open' } });
 if (result.cancelled || !result.path) return;
 const { project } = await call('projects_open_file', { request: { path: result.path } });
 await onOpen(project);
}

export function ProjectFileHome({ call, onOpen, welcome = false }) {
 const [projects, setProjects] = useState([]);
 const [loading, setLoading] = useState(true);
 const [name, setName] = useState('');
 const [busy, setBusy] = useState(false);
 const [error, setError] = useState('');
 useEffect(() => { let active = true; call('projects_list').then(result => { if(active)setProjects(result.projects || []); }).catch(reason => { if(active)setError(reason.message); }).finally(() => { if(active)setLoading(false); }); return () => { active = false; }; }, [call]);
 const run = async work => { setBusy(true); setError(''); try { await work(); } catch (reason) { setError(reason.message); } finally { setBusy(false); } };
 const create = async () => {
  const result = await call('projects_choose_file', { request: { action: 'save', name: name.trim() } });
  if (result.cancelled || !result.path) return;
  const capabilities = await call('capabilities');
  const [goals, templates] = await Promise.all([capabilities.literature ? call('goals_list') : { goals: [] }, capabilities.documents ? call('templates_list') : { templates: [] }]);
  const goal = goals.goals?.find(row => row.id === 'default-research') || goals.goals?.[0];
  const template = templates.templates?.find(row => row.id === 'nature-default') || templates.templates?.[0];
  const profiles = goal && template ? { goalProfileId: goal.id, goalProfileVersion: goal.version, templateId: template.id, templateVersion: template.version } : {};
  const { project } = await call('projects_create', { request: { fields: { name: name.trim(), projectFilePath: result.path, ...profiles } } });
  await onOpen(project);
 };
 const recent = async project => {
  if (project.projectFilePath) project = (await call('projects_open_file', { request: { path: project.projectFilePath } })).project;
  await onOpen(project);
 };
 return h('section', { className: `ib-project-file-home${welcome ? ' ib-project-file-welcome' : ''}` },
  h(welcome ? 'h1' : 'h2', null, welcome ? '欢迎使用 iBM Lab' : '打开或新建项目'),
  h('p', null, '打开 .ibmproject 文件进入项目空间。'),
  h('div', { className: 'ib-project-file-entry-grid' },
  h('div', { className: 'ib-project-file-start' },
  h('div', { className: 'ib-project-file-actions' }, h('button', { className: 'ib-btn', 'data-primary': true, disabled: busy, onClick: () => void run(() => chooseProjectFile(call, onOpen)) }, '打开项目…')),
  h('form', { className: 'ib-project-file-new', onSubmit: event => { event.preventDefault(); if(name.trim() && !busy)void run(create); } },
   h('label', { htmlFor: 'ib-project-name' }, '新建项目'),
   h('div', null, h('input', { id: 'ib-project-name', value: name, maxLength: 120, disabled: busy, placeholder: '输入项目名称', onChange: event => setName(event.target.value) }), h('button', { className: 'ib-btn', type: 'submit', disabled: busy || !name.trim() }, busy ? '正在处理…' : '选择保存位置并创建…')),
   h('small', null, '请为每个项目选择独立的文件夹。后续修改自动保存；迁移时复制或移动整个文件夹。'))),
  h('div', { className: 'ib-project-file-history' },
  h('h3', null, '最近项目'),
  loading ? h('p', { role: 'status' }, '正在读取最近项目…') : !projects.length ? h('p', null, '还没有项目，可以新建或打开已有工程文件。') : h('div', { className: 'ib-project-file-recents' }, projects.map(project => h('button', { className: 'ib-project-file-recent', key: project.id, disabled: busy, onClick: () => void run(() => recent(project)), title: project.projectFilePath || project.workspacePath }, h('strong', null, project.name), h('span', null, project.projectFilePath || '旧课题 · 首次打开时创建工程文件'), project.projectFileError ? h('span', { className: 'ib-error' }, '文件无法读取，请选择移动后或恢复后的工程文件重新打开。') : null))))),
  error ? h('div', { className: 'ib-error', role: 'alert' }, error) : null);
}

