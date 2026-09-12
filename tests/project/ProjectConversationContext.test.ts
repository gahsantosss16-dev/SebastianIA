import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectRegistry } from '../../core/project/ProjectRegistry.js';
import { ProjectConversationContext } from '../../core/project/ProjectConversationContext.js';
import { loadProjectPolicies } from '../../core/project/ProjectWorkspacePolicy.js';
import { FileMemoryStore } from '../../core/memory/FileMemoryStore.js';
import { loadConfiguredProjects } from '../../application/ProjectConfiguration.js';
import type { ProjectDescriptor } from '../../core/project/ProjectTypes.js';
import { createSebastianApplication } from '../../application/SebastianApplication.js';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'sebastian-projects-'));
  const entries = (JSON.parse(readFileSync(new URL('../../config/projects.local.json', import.meta.url), 'utf8')) as {projects: ProjectDescriptor[]}).projects.map(project => {
    const checkout = join(root, project.id);
    mkdirSync(checkout);
    writeFileSync(join(checkout, 'CLAUDE.md'), `# ${project.id}\n## Migrations\nRegra exclusiva ${project.id}.`);
    writeFileSync(join(checkout, 'AGENTS.md'), `# ${project.id} agents`);
    writeFileSync(join(checkout, 'extra.md'), '# Adicional\nPolítica adicional.');
    return { ...project, workspace: { ...project.workspace!, root: checkout, environment: {id:'test',platform:process.platform as 'win32',label:'Teste'}, policySources:[{path:'CLAUDE.md',required:true,topics:[]},{path:'AGENTS.md',required:true,topics:[]},{path:'extra.md',required:false,topics:['adicional']}]} };
  });
  const registry = new ProjectRegistry({readOnly:true,entries});
  const store = new FileMemoryStore(join(root, 'memory.json'));
  return {root, entries, registry,store, context:new ProjectConversationContext(registry,store,'test')};
}
test('all configured exact aliases resolve and unknown or ambiguous aliases never select another project', () => {
  const {registry,context} = fixture();
  for(const [alias,id] of [['Neuro','neuro-hub-pro'],['Neuro Hub','neuro-hub-pro'],['Neuro Hub Pro','neuro-hub-pro'],['LSB','lsb-service'],['LSB Service','lsb-service'],['Sebastian','sebastiania'],['SebastianIA','sebastiania']]) assert.equal(registry.resolve(alias!)?.id,id);
  assert.equal(registry.resolve('Neur'),undefined);
  assert.match(context.handle('c','Use o Neur','e','2026-09-12')!.message,/desconhecido/);
  assert.equal(context.active('c'),null);
  assert.match(context.handle('c','Use Neuro e LSB','e','2026-09-12')!.message,/ambíguo/);
});
test('selection, rule hashes and isolated conversation survive a new context instance; switch does not inherit policy', () => {
  const {context,store,registry}=fixture();
  assert.equal(context.handle('c','Sebastian, analisa X no Neuro','e1','2026-09-12')!.project?.id,'neuro-hub-pro');
  assert.match(context.handle('c','Quais regras você precisa considerar neste projeto?','e2','2026-09-12')!.message,/Regra exclusiva neuro-hub-pro/);
  context.handle('c','Agora use o LSB.','e3','2026-09-12');
  const reply=context.handle('c','Quais regras neste projeto?','e4','2026-09-12')!;
  assert.match(reply.message,/Regra exclusiva lsb-service/);
  assert.doesNotMatch(reply.message,/Regra exclusiva neuro-hub-pro/);
  assert.equal(new ProjectConversationContext(registry,store,'test').active('c')?.id,'lsb-service');
  assert.equal(context.active('other'),null);
  const audit=store.listRecords('project-policy-uses');
  assert.equal(audit.length,4);
  assert.match(JSON.stringify(audit),/"hash":"[a-f0-9]{64}"/);
  assert.doesNotMatch(JSON.stringify(audit),/Regra exclusiva/);
});
test('policy loader loads required and task-specific sources, rehashes edits and never substitutes cwd', () => {
  const {entries}=fixture(); const project=entries[0]!;
  assert.equal(loadProjectPolicies(project,'test','normal').length,2);
  assert.equal(loadProjectPolicies(project,'test','regra adicional').length,3);
  const first=loadProjectPolicies(project,'test','normal')[0]!.hash;
  writeFileSync(join(project.workspace.root,'CLAUDE.md'),'# Mudança de regra');
  assert.notEqual(loadProjectPolicies(project,'test','normal')[0]!.hash,first);
  assert.throws(()=>loadProjectPolicies({...project,workspace:{...project.workspace,root:join(project.workspace.root,'missing')}},'test',''),/Checkout configurado ausente/);
  assert.throws(()=>loadProjectPolicies(project,'server',''),/não acessa o computador/);
});
test('invalid config and policy outside configured root fail safely; unavailable selection clears previous rules', () => {
  const {context,registry,entries,root}=fixture();
  assert.throws(()=>new ProjectRegistry({entries:[{...entries[0]!,workspace:{...entries[0]!.workspace,policySources:[{path:'../secret.md',required:true,topics:[]}]}}]}));
  const malformed=join(root,'invalid.json');writeFileSync(malformed,'{}');
  assert.throws(()=>loadConfiguredProjects(registry,{SEBASTIAN_PROJECTS_FILE:malformed}),/Configuração de projetos inválida/);
  assert.throws(()=>new ProjectRegistry({entries:[entries[0]!,{...entries[1]!,aliases:['Neuro']}]}));
  context.handle('c','Use o Neuro','e1','2026-09-12');
  const absent = new ProjectRegistry({entries:[entries[0]!,{...entries[1]!,workspace:{...entries[1]!.workspace,root:join(root,'absent')}}]});
  const store = new FileMemoryStore(join(root,'memory.json'));
  const reply=new ProjectConversationContext(absent,store,'test').handle('c','Use o LSB','e2','2026-09-12')!;
  assert.equal(reply.project?.id,'lsb-service');assert.equal(reply.project?.policyStatus,'unavailable');assert.match(reply.message,/ausente/);
});
test('real Core handoff resolves identity without invoking a model or tool, and stores conversation result',async()=>{
  const {context,root}=fixture();let calls=0;
  const core=createSebastianApplication({dataDir:root,projectContext:context,authorizedCommands:[],specializedTool:{invoke(){calls++;throw new Error('must not execute');}}});
  try {
    for (const [index,text] of ['Sebastian, qual projeto está ativo?','Use o Neuro.','Quais regras você precisa considerar neste projeto?','Agora use o LSB.'].entries()) {
      const result=await core.executeCommand({type:'converse',input:{text},generatedAt:new Date(1_800_000_000_000+index).toISOString(),conversation:{conversationId:'conversation-test'},session:{conversationId:'conversation-test',sessionId:'session-test'}});
      assert.equal(typeof result.output.message,'string');
    }
    assert.equal(context.active('conversation-test')?.id,'lsb-service');assert.equal(calls,0);
  } finally {core.shutdown();}
});
