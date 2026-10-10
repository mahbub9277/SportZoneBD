import assert from 'node:assert/strict'
import { test } from 'node:test'
import { MODERATOR_PERMISSIONS, defaultPermissions, defaultRoles, rolePermissions } from './rbacConfig.js'

const permissionKeys = new Set(defaultPermissions.map((permission) => permission.key))

test('the moderator role is a seeded system role', () => {
  const moderator = defaultRoles.find((role) => role.name === 'moderator')
  assert.ok(moderator, 'a moderator role must exist in the seed')
  assert.equal(moderator.isSystem, true)
})

test('seed definitions contain no duplicate roles or permissions', () => {
  const roleNames = defaultRoles.map((role) => role.name)
  assert.equal(new Set(roleNames).size, roleNames.length, 'role names must be unique')
  assert.equal(
    permissionKeys.size,
    defaultPermissions.length,
    'permission keys must be unique',
  )
})

test('every granted permission is declared in the seed', () => {
  for (const [roleName, permissions] of Object.entries(rolePermissions)) {
    for (const permission of permissions) {
      assert.ok(permissionKeys.has(permission), `${roleName} grants undeclared permission ${permission}`)
    }
  }
})

test('every seeded role has an explicit permission list', () => {
  for (const role of defaultRoles) {
    assert.ok(Array.isArray(rolePermissions[role.name]), `${role.name} has no permission entry`)
  }
})

test('a moderator is limited to the project-management permission set', () => {
  assert.deepEqual([...rolePermissions.moderator].sort(), [...MODERATOR_PERMISSIONS].sort())
})

test('a moderator never receives administrative, billing, settings or engagement authority', () => {
  const forbidden = [
    'admin.dashboard.view',
    'admin.users.manage',
    'admin.settings.manage',
    'admin.payments.view',
    'admin.content.manage',
    'content.live.watch',
  ]

  for (const permission of forbidden) {
    assert.ok(
      !rolePermissions.moderator.includes(permission as (typeof rolePermissions.moderator)[number]),
      `moderator must not hold ${permission}`,
    )
  }
})

test('admins keep every permission they had before the moderator permissions were split out', () => {
  const preExisting = [
    'admin.dashboard.view',
    'admin.users.manage',
    'admin.matches.manage',
    'admin.settings.manage',
    'admin.payments.view',
    'content.highlights.view',
  ]

  for (const roleName of ['admin', 'super_admin'] as const) {
    for (const permission of preExisting) {
      assert.ok(
        rolePermissions[roleName].includes(permission as (typeof rolePermissions.admin)[number]),
        `${roleName} lost ${permission}`,
      )
    }
  }

  assert.ok(rolePermissions.super_admin.includes('content.live.watch'), 'super admin keeps live content access')
})
