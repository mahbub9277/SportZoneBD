import test from 'node:test'
import assert from 'node:assert/strict'
import {
  EXPERIENCE_HOME,
  EXPERIENCE_LOGIN,
  getRoleNames,
  getUserPermissions,
  hasAnyPermission,
  hasCustomRole,
  hasPermission,
  resolveAuthExperience,
} from './roleExperience.ts'
import type { User } from './auth.types.ts'

type ProfileRole = NonNullable<User['roles']>[number]

const user = (overrides: Partial<User> = {}): User => ({
  id: 'user-1',
  email: 'person@sportzonebd.com',
  fullName: 'Person',
  avatar: null,
  createdAt: new Date().toISOString(),
  isActive: true,
  roles: [],
  ...overrides,
})

/** The shape `/auth/me` really returns: each entry wraps the role under a `role` key. */
const profileRole = (name: string, isSystem: boolean, permissions: string[] = []): ProfileRole =>
  ({
    role: { id: name, name, isSystem, permissions: permissions.map((key) => ({ key })) },
  }) as unknown as ProfileRole

/** The flattened shape some endpoints return. */
const flatRole = (name: string, isSystem: boolean, permissions: string[] = []): ProfileRole =>
  ({ id: name, name, isSystem, permissions: permissions.map((key) => ({ key })) })

const MODERATOR_PERMISSIONS = ['moderator.dashboard.view', 'admin.matches.manage', 'admin.streams.manage']

test('an administrator resolves to the admin console', () => {
  assert.equal(resolveAuthExperience(user({ roles: [profileRole('admin', true)] })), 'admin')
  assert.equal(resolveAuthExperience(user({ roles: [profileRole('super_admin', true)] })), 'admin')
})

test('a moderator resolves to the moderator console, ahead of any custom role', () => {
  assert.equal(
    resolveAuthExperience(user({ roles: [profileRole('moderator', true, MODERATOR_PERMISSIONS)] })),
    'moderator',
  )
  assert.equal(
    resolveAuthExperience(user({ roles: [profileRole('moderator', true), profileRole('editor', false)] })),
    'moderator',
    'a moderator who also holds a custom role still belongs to the moderator console',
  )
})

test('an administrator-made custom role resolves to the shared staff console', () => {
  assert.equal(resolveAuthExperience(user({ roles: [profileRole('editor', false)] })), 'staff')
})

test('seeded end-user roles stay in the public application', () => {
  assert.equal(resolveAuthExperience(user({ roles: [profileRole('user', true)] })), 'user')
  assert.equal(resolveAuthExperience(user({ roles: [profileRole('premium_user', true)] })), 'user')
  assert.equal(resolveAuthExperience(user({ roles: [] })), 'user')
  assert.equal(resolveAuthExperience(null), 'user')
})

test('a role that cannot be proven administrator-made never grants a console', () => {
  const mystery = { role: { name: 'mystery' } } as unknown as ProfileRole
  assert.equal(resolveAuthExperience(user({ roles: [mystery] })), 'user')
  assert.equal(hasCustomRole(user({ roles: [mystery] })), false)
})

test('role names are read from both profile shapes', () => {
  assert.deepEqual(getRoleNames(user({ roles: [profileRole('admin', true)] })), ['admin'])
  assert.deepEqual(getRoleNames(user({ roles: [flatRole('editor', false)] })), ['editor'])
  assert.deepEqual(getRoleNames(null), [])
})

test('permissions are collected from the profile and from each role, without duplicates', () => {
  const person = user({
    permissions: ['admin.matches.manage'],
    roles: [profileRole('moderator', true, ['admin.matches.manage', 'admin.streams.manage'])],
  })

  assert.deepEqual(getUserPermissions(person).sort(), ['admin.matches.manage', 'admin.streams.manage'])
  assert.equal(hasPermission(person, 'admin.streams.manage'), true)
  assert.equal(hasPermission(person, 'admin.users.manage'), false)
  assert.equal(hasAnyPermission(person, ['admin.users.manage', 'admin.streams.manage']), true)
  assert.equal(hasAnyPermission(person, ['admin.users.manage']), false)
})

test('flat role entries are read the same way as nested ones', () => {
  const person = user({ roles: [flatRole('editor', false, ['admin.highlights.manage'])] })
  assert.deepEqual(getUserPermissions(person), ['admin.highlights.manage'])
  assert.equal(hasCustomRole(person), true)
})

test('a custom role with no permissions unlocks nothing', () => {
  const editor = user({ roles: [profileRole('editor', false)] })
  assert.deepEqual(getUserPermissions(editor), [])
  assert.equal(hasAnyPermission(editor, ['admin.matches.manage']), false)
})

test('each experience has exactly one home and one sign-in route', () => {
  for (const experience of ['admin', 'moderator', 'staff', 'user'] as const) {
    assert.ok(EXPERIENCE_HOME[experience].startsWith('/'))
    assert.ok(EXPERIENCE_LOGIN[experience].startsWith('/'))
  }

  assert.equal(EXPERIENCE_HOME.moderator, '/moderator')
  assert.equal(EXPERIENCE_LOGIN.moderator, '/moderator/login')
  assert.equal(EXPERIENCE_HOME.staff, '/staff')
  assert.equal(EXPERIENCE_LOGIN.staff, '/staff/login')
})
