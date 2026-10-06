import { createClient } from '@qb-flex/client';
import './styles.css';
const get = (id) => document.getElementById(id);
let qb, channel, stopAuth, objectId, readController, activeIdentity;
async function action(fn) {
  get('error').hidden = true;
  try {
    return await fn();
  } catch (error) {
    if (error.code === 'ABORTED') return;
    get('error').textContent = error.message;
    get('error').hidden = false;
  }
}
async function refreshTasks() {
  readController?.abort();
  readController = new AbortController();
  const identity = qb.getIdentityVersion();
  const result = await qb.from('tasks').abortSignal(readController.signal);
  if (identity !== qb.getIdentityVersion()) return;
  get('tasks').replaceChildren(
    ...result.data.map((task) => {
      const item = document.createElement('li'),
        label = document.createElement('label'),
        checkbox = document.createElement('input'),
        text = document.createElement('span'),
        remove = document.createElement('button');
      checkbox.type = 'checkbox';
      checkbox.checked = !!task.completed;
      text.textContent = task.title;
      text.className = task.completed ? 'completed' : '';
      checkbox.onchange = () =>
        action(async () => {
          await qb
            .from('tasks')
            .update(
              task.id,
              { completed: checkbox.checked ? 1 : 0 },
              { revision: Number(task.revision) },
            );
          await refreshTasks();
        });
      remove.textContent = 'Delete';
      remove.className = 'button button-ghost';
      remove.onclick = () =>
        action(async () => {
          await qb.from('tasks').delete(task.id);
          await refreshTasks();
        });
      label.append(checkbox, text);
      item.append(label, remove);
      return item;
    }),
  );
  return result;
}
async function renderSession(session) {
  const currentIdentity = session?.user.id ?? null;
  if (activeIdentity === currentIdentity) return;
  activeIdentity = currentIdentity;
  readController?.abort();
  objectId = null;
  get('download').disabled = true;
  get('remove-file').disabled = true;
  get('authentication').hidden = !!session;
  get('workspace').hidden = !session;
  channel?.unsubscribe();
  channel = null;
  get('tasks').replaceChildren();
  if (!session) return;
  get('account-label').textContent = session.user.email;
  const result = await refreshTasks();
  if (currentIdentity !== activeIdentity) return;
  channel = qb
    .channel({
      table: 'tasks',
      cursor: result?.meta.consistencyToken,
      onEvent: () => action(refreshTasks),
      onStatus: (status) => (get('connection-label').textContent = `Realtime: ${status}`),
      onResync: () => action(refreshTasks),
    })
    .subscribe();
}
get('connect').onsubmit = (event) => {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  void action(async () => {
    qb = createClient({
      url: data.get('url'),
      projectId: data.get('project'),
      branch: data.get('branch'),
      publishableKey: data.get('key'),
    });
    get('configuration').hidden = true;
    get('authentication').hidden = false;
    stopAuth = qb.onAuthStateChange((session) => action(() => renderSession(session)));
    await qb.auth.refreshSession();
  });
};
get('sign-in').onsubmit = (event) => {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  void action(() =>
    event.submitter.value === 'signup'
      ? qb.auth.signUp({
          email: data.get('email'),
          password: data.get('password'),
          name: data.get('name') || 'Application user',
        })
      : qb.auth.signIn({ email: data.get('email'), password: data.get('password') }),
  );
};
get('sign-out').onclick = () => action(() => qb.auth.signOut());
get('add-task').onsubmit = (event) => {
  event.preventDefault();
  const input = event.currentTarget.elements.title;
  void action(async () => {
    await qb
      .from('tasks')
      .insert(
        { title: input.value, owner_id: qb.getSession().user.id },
        { idempotencyKey: crypto.randomUUID() },
      );
    input.value = '';
    await refreshTasks();
  });
};
get('file').onchange = (event) =>
  action(async () => {
    const file = event.target.files?.[0];
    if (!file) return;
    const result = await qb.storage.upload(get('bucket').value, file.name, file);
    objectId = result.data.id;
    get('download').disabled = false;
    get('remove-file').disabled = false;
  });
get('download').onclick = () =>
  action(async () => {
    const blob = await qb.storage.download(objectId),
      url = URL.createObjectURL(blob),
      a = document.createElement('a');
    a.href = url;
    a.download = 'attachment';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
get('remove-file').onclick = () =>
  action(async () => {
    await qb.storage.remove(objectId);
    objectId = null;
    get('download').disabled = true;
    get('remove-file').disabled = true;
  });
window.addEventListener('pagehide', () => {
  readController?.abort();
  channel?.unsubscribe();
  stopAuth?.();
  qb?.dispose();
});
