import assert from 'node:assert/strict'
import { test } from 'node:test'
import { canAssignRole, findUngrantableRole, isPrivilegedRoleName, permissionsAllow, rolesAllow } from './access.js'

test('a super admin can grant any role', () => {
  for (const role of ['super_admin', 'admin', 'moderator', 'editor', 'user']) {
    assert.equal(canAssignRole(['super_admin'], role), true, `super_admin should grant ${role}`)
  }
})

test('admin and super admin have equal role-assignment powers', () => {
  for (const actorRole of ['admin', 'super_admin']) {
    for (const granted of ['super_admin', 'admin', 'moderator', 'editor', 'user']) {
      assert.equal(
        canAssignRole([actorRole], granted),
        true,
        `${actorRole} should grant ${granted}, exactly as its peer role does`,
      )
    }
  }

  // Both administrative roles are interchangeable for role assignment: neither is more powerful.
  for (const granted of ['super_admin', 'admin', 'moderator', 'editor']) {
    assert.equal(canAssignRole(['admin'], granted), canAssignRole(['super_admin'], granted))
  }
})

test('a moderator or plain user cannot grant a privileged role', () => {
  for (const actor of [['moderator'], ['user'], [], ['premium_user']]) {
    assert.equal(canAssignRole(actor, 'admin'), false, `${actor.join(',')} must not grant admin`)
    assert.equal(canAssignRole(actor, 'super_admin'), false, `${actor.join(',')} must not grant super_admin`)
  }
})

test('non-administrative roles can still receive ordinary roles', () => {
  // Only the administrative roles are restricted; a moderator or custom role remains assignable.
  assert.equal(findUngrantableRole(['admin'], ['editor', 'moderator', 'super_admin', 'admin']), null)
  assert.equal(findUngrantableRole(['moderator'], ['editor']), null)
  assert.equal(findUngrantableRole(['admin'], ['editor']), null)
})

test('the ungrantable check names the first role a non-administrative actor may not grant', () => {
  assert.equal(findUngrantableRole(['moderator'], ['editor', 'admin', 'super_admin']), 'admin')
  assert.equal(findUngrantableRole(['editor'], ['super_admin', 'admin']), 'super_admin')
  assert.equal(findUngrantableRole([], ['super_admin']), 'super_admin')
})

test('only admin and super admin are treated as privileged role names', () => {
  assert.equal(isPrivilegedRoleName('admin'), true)
  assert.equal(isPrivilegedRoleName('super_admin'), true)
  assert.equal(isPrivilegedRoleName('moderator'), false)
  assert.equal(isPrivilegedRoleName('editor'), false)
})

test('role checks deny by default', () => {
  assert.equal(rolesAllow(['moderator'], ['admin', 'super_admin', 'moderator']), true)
  assert.equal(rolesAllow(['moderator'], ['admin', 'super_admin']), false)
  assert.equal(rolesAllow(['user'], ['admin', 'super_admin']), false)
  assert.equal(rolesAllow([], ['admin']), false, 'a user with no roles satisfies no requirement')
  assert.equal(rolesAllow(undefined, ['admin']), false, 'a missing role list satisfies no requirement')
  assert.equal(rolesAllow(['user'], []), true, 'an empty requirement places no restriction')
})

test('permission checks deny by default', () => {
  const moderatorPermissions = [
    'moderator.dashboard.view',
    'admin.matches.manage',
    'admin.streams.manage',
  ]

  assert.equal(permissionsAllow(moderatorPermissions, ['admin.matches.manage']), true)
  assert.equal(permissionsAllow(moderatorPermissions, ['admin.users.manage']), false)
  assert.equal(
    permissionsAllow(moderatorPermissions, ['admin.matches.manage', 'admin.users.manage']),
    false,
    'every requested permission must be held',
  )
  assert.equal(permissionsAllow([], ['admin.matches.manage']), false, 'no permissions means no access')
  assert.equal(permissionsAllow(undefined, ['admin.matches.manage']), false, 'a missing list means no access')
  assert.equal(permissionsAllow([], []), true, 'an empty requirement places no restriction')
})
