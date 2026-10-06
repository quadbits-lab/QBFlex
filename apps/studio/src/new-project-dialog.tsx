import { useForm } from '@tanstack/react-form';
import { useQueryClient } from '@tanstack/react-query';
import { Field, FieldGroup, FieldLabel, FieldDescription, Input, Spinner, toast, notifyError } from '@qb-flex/ui';
import { useNavigate } from '@tanstack/react-router';
import { Modal, Button } from '@qb-flex/ui';
import { management } from './api';
import { useConsole } from './console-context';

export function NewProjectDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { state, select } = useConsole();
  const navigate = useNavigate();
  const cache = useQueryClient();
  const create = useForm({
    defaultValues: { name: '', slug: '' },
    onSubmit: async ({ value }) => {
      try {
        if (!value.name.trim()) throw new Error('Enter a project name');
        if (!value.slug.trim()) throw new Error('Enter a project slug');
        const result = await management.request<{ id: string }>('/projects', 'POST', {
          ...value,
          organizationId: state.organization,
          region: 'local',
        });
        await cache.invalidateQueries({ queryKey: ['projects'] });
        select({ project: result.data.id, branch: 'primary' });
        create.reset();
        toast.success('Project created');
        void navigate({ to: '/overview' });
        onOpenChange(false);
      } catch (submitError) {
        notifyError(submitError, 'Unable to create project');
      }
    },
  });
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Create a project"
      description="Provision an isolated SQLite database and application realm."
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void create.handleSubmit();
        }}
      >
        <FieldGroup>
          {(['name', 'slug'] as const).map((name) => (
            <create.Field key={name} name={name}>
              {(field) => (
                <Field>
                  <FieldLabel htmlFor={'project-' + name}>
                    {name === 'name' ? 'Project name' : 'Project slug'}
                  </FieldLabel>
                  <Input
                    id={'project-' + name}
                    required
                    value={field.state.value}
                    pattern={name === 'slug' ? '[a-z0-9][a-z0-9-]*' : undefined}
                    onChange={(e) => field.handleChange(e.target.value)}
                  />
                </Field>
              )}
            </create.Field>
          ))}
          <Field data-disabled>
            <FieldLabel htmlFor="project-region">Region</FieldLabel>
            <Input id="project-region" value="Local / single node" disabled />
            <FieldDescription>
              Database and authentication are isolated per project.
            </FieldDescription>
          </Field>
          <create.Subscribe selector={(s) => s.isSubmitting}>
            {(pending) => (
              <Button type="submit" disabled={pending}>
                {pending && <Spinner data-icon="inline-start" />}
                {pending ? 'Provisioning…' : 'Create project'}
              </Button>
            )}
          </create.Subscribe>
        </FieldGroup>
      </form>
    </Modal>
  );
}
