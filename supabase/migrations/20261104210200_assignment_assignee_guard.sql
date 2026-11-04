-- Restrict teammate updates on work_assignments to progress/submit fields.
-- LIVE gates unchanged.

create or replace function private.guard_work_assignment_assignee_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select private.can_admin_project(old.project_id)) then
    return new;
  end if;

  if old.assignee_user_id is distinct from (select auth.uid()) then
    raise exception 'not allowed to update this assignment';
  end if;

  if new.company_id is distinct from old.company_id
    or new.project_id is distinct from old.project_id
    or new.next_action_id is distinct from old.next_action_id
    or new.agent_task_id is distinct from old.agent_task_id
    or new.kind is distinct from old.kind
    or new.title is distinct from old.title
    or new.instructions is distinct from old.instructions
    or new.due_at is distinct from old.due_at
    or new.assignee_user_id is distinct from old.assignee_user_id
    or new.assigned_by is distinct from old.assigned_by
    or new.review_note is distinct from old.review_note
    or new.reviewed_by is distinct from old.reviewed_by
    or new.reviewed_at is distinct from old.reviewed_at
    or new.handed_off_from_assignment_id is distinct from old.handed_off_from_assignment_id
    or new.map_scope is distinct from old.map_scope
  then
    raise exception 'assignees may only update progress, submission, and status';
  end if;

  if new.status not in ('ASSIGNED', 'IN_PROGRESS', 'SUBMITTED') then
    raise exception 'assignees may not set status %', new.status;
  end if;

  if old.status = 'SUBMITTED' and new.status is distinct from 'SUBMITTED' then
    raise exception 'submitted work awaits reviewer action';
  end if;

  return new;
end;
$$;

drop trigger if exists work_assignments_guard_assignee_update on public.work_assignments;
create trigger work_assignments_guard_assignee_update
  before update on public.work_assignments
  for each row execute function private.guard_work_assignment_assignee_update();

revoke all on function private.guard_work_assignment_assignee_update() from public, anon;
