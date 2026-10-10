import test from 'node:test'
import assert from 'node:assert/strict'
import { CONSOLE_MODULES, buildConsoleNav, selectConsoleModules } from './consoleNav.config.ts'

const MODERATOR_PERMISSIONS = [
  'moderator.dashboard.view',
  'admin.matches.manage',
  'admin.streams.manage',
  'admin.channels.manage',
  'admin.events.manage',
  'admin.highlights.manage',
  'admin.banners.manage',
  'admin.teams.view',
  'admin.media.manage',
]

test('every console module names the permission it needs', () => {
  for (const module of CONSOLE_MODULES) {
    assert.ok(module.permission.length > 0, `${module.label} must declare a permission`)
    assert.ok(module.path.length > 0, `${module.label} must declare a path`)
  }
})

test('a moderator sees exactly the project-management modules', () => {
  const labels = selectConsoleModules(MODERATOR_PERMISSIONS).map((module) => module.label)
  assert.deepEqual(labels, ['Matches', 'Streams', 'Highlights', 'Channels', 'Events', 'Banner Manager'])
})

test('a role with no permissions unlocks no modules', () => {
  assert.deepEqual(selectConsoleModules([]), [])
})

test('an unrelated permission does not leak a module', () => {
  assert.deepEqual(selectConsoleModules(['admin.users.manage', 'admin.payments.view']), [])
})

test('hrefs are built from the console prefix so the same module works in every console', () => {
  const moderatorNav = buildConsoleNav('/moderator', MODERATOR_PERMISSIONS)
  const staffNav = buildConsoleNav('/staff', MODERATOR_PERMISSIONS)

  const flat = (sections: ReturnType<typeof buildConsoleNav>) =>
    sections.flatMap((section) => section.links.map((link) => link.href))

  assert.ok(flat(moderatorNav).includes('/moderator/matches'))
  assert.ok(flat(moderatorNav).includes('/moderator'))
  assert.ok(flat(staffNav).includes('/staff/matches'))
  assert.ok(!flat(staffNav).some((href) => href.startsWith('/admin')))
})

test('the content section disappears when nothing in it is permitted', () => {
  const sections = buildConsoleNav('/staff', [])

  assert.deepEqual(sections.map((section) => section.title), ['General'])
  assert.deepEqual(sections[0].links.map((link) => link.href), ['/staff', '/staff/profile'])
})

test('a module with submodules only shows the submodule links it may use', () => {
  const sections = buildConsoleNav('/moderator', ['admin.matches.manage'])
  const matches = sections.flatMap((section) => section.links).find((link) => link.label === 'Matches')

  assert.ok(matches, 'the permitted Matches module must be present')
  assert.deepEqual(
    matches?.subLinks?.map((link) => link.href),
    ['/moderator/matches', '/moderator/live-matches', '/moderator/upcoming-matches', '/moderator/finished-matches'],
  )
})
