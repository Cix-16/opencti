import { map } from 'ramda';
import { delEditContext, setEditContext } from '../database/redis';
import {
  createRelation,
  deleteEntityById,
  deleteRelationById,
  updateAttribute,
  getById,
  dayFormat,
  monthFormat,
  yearFormat,
  notify,
  now,
  paginate,
  getObject,
  takeWriteTx,
  prepareString
} from '../database/grakn';
import { BUS_TOPICS } from '../config/conf';

export const findAll = args => paginate('match $w isa Workspace', args);

export const findById = workspaceId => getById(workspaceId);

export const ownedBy = workspaceId =>
  getObject(
    `match $x isa User; 
    $rel(owner:$x, to:$workspace) isa owned_by; 
    $workspace id ${workspaceId}; get $x, $rel; offset 0; limit 1;`,
    'x',
    'rel'
  );

export const markingDefinitions = (workspaceId, args) =>
  paginate(
    `match $marking isa Marking-Definition; 
    $rel(marking:$marking, so:$workspace) isa object_marking_refs; 
    $workspace id ${workspaceId}`,
    args,
    false
  );

export const objectRefs = (workspaceId, args) =>
  paginate(
    `match $so isa Stix-Domain-Entity; 
    $rel(so:$so, knowledge_aggregation:$workspace) isa object_refs; 
    $workspace id ${workspaceId}`,
    args,
    false
  );

export const addWorkspace = async (user, workspace) => {
  const wTx = await takeWriteTx();
  const workspaceIterator = await wTx.query(`insert $workspace isa Workspace,
    has entity_type "workspace",
    has name "${prepareString(workspace.name)}",
    has description "${prepareString(workspace.description)}",
    has created_at ${now()},
    has created_at_day "${dayFormat(now())}",
    has created_at_month "${monthFormat(now())}",
    has created_at_year "${yearFormat(now())}",          
    has updated_at ${now()};
  `);
  const createdWorkspace = await workspaceIterator.next();
  const createdWorkspaceId = await createdWorkspace.map().get('workspace').id;

  await wTx.query(`match $from id ${createdWorkspaceId};
         $to id ${user.id};
         insert (to: $from, owner: $to)
         isa owned_by;`);

  if (workspace.markingDefinitions) {
    const createMarkingDefinition = markingDefinition =>
      wTx.query(
        `match $from id ${createdWorkspaceId}; $to id ${markingDefinition}; insert (so: $from, marking: $to) isa object_marking_refs;`
      );
    const markingDefinitionsPromises = map(
      createMarkingDefinition,
      workspace.markingDefinitions
    );
    await Promise.all(markingDefinitionsPromises);
  }

  await wTx.commit();

  return getById(createdWorkspaceId).then(created =>
    notify(BUS_TOPICS.Workspace.ADDED_TOPIC, created, user)
  );
};

export const workspaceDelete = workspaceId => deleteEntityById(workspaceId);

export const workspaceAddRelation = (user, workspaceId, input) =>
  createRelation(workspaceId, input).then(relationData => {
    notify(BUS_TOPICS.Workspace.EDIT_TOPIC, relationData.node, user);
    return relationData;
  });

export const workspaceAddRelations = async (user, workspaceId, input) => {
  const finalInput = map(
    n => ({
      toId: n,
      fromRole: input.fromRole,
      toRole: input.toRole,
      through: input.through
    }),
    input.toIds
  );

  const wTx = await takeWriteTx();
  const createRelationPromise = relationInput =>
    wTx.query(`match $from id ${workspaceId}; 
         $to id ${relationInput.toId}; 
         insert $rel(${relationInput.fromRole}: $from, ${
      relationInput.toRole
    }: $to) 
         isa ${relationInput.through};`);

  const relationsPromises = map(createRelationPromise, finalInput);
  await Promise.all(relationsPromises);

  await wTx.commit();

  return getById(workspaceId).then(workspace =>
    notify(BUS_TOPICS.Workspace.EDIT_TOPIC, workspace, user)
  );
};

export const workspaceDeleteRelation = (user, workspaceId, relationId) =>
  deleteRelationById(workspaceId, relationId).then(relationData => {
    notify(BUS_TOPICS.Workspace.EDIT_TOPIC, relationData.node, user);
    return relationData;
  });

export const workspaceCleanContext = (user, workspaceId) => {
  delEditContext(user, workspaceId);
  return getById(workspaceId).then(workspace =>
    notify(BUS_TOPICS.Workspace.EDIT_TOPIC, workspace, user)
  );
};

export const workspaceEditContext = (user, workspaceId, input) => {
  setEditContext(user, workspaceId, input);
  return getById(workspaceId).then(workspace =>
    notify(BUS_TOPICS.Workspace.EDIT_TOPIC, workspace, user)
  );
};

export const workspaceEditField = (user, workspaceId, input) =>
  updateAttribute(workspaceId, input).then(workspace =>
    notify(BUS_TOPICS.Workspace.EDIT_TOPIC, workspace, user)
  );