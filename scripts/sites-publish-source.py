#!/usr/bin/env python3
"""Static publishing fallback when the Sites plugin's bundled helper is absent.

Credentials arrive through hidden stdin, remain in process memory, and are never
written into Git configuration, an archive, a URL, or a command argument.
"""
import json
import os
import subprocess
import sys
import termios
from pathlib import Path
from urllib.parse import urlparse

root = Path('/workspace/sites/shell-public')
manifest = json.loads((root / '.openai/hosting.json').read_text())
previous = termios.tcgetattr(sys.stdin.fileno())
hidden = previous[:]
hidden[3] &= ~termios.ECHO
termios.tcsetattr(sys.stdin.fileno(), termios.TCSANOW, hidden)
print('Ready for Site credential JSON on stdin (input is hidden).', flush=True)
try:
    credential = json.loads(sys.stdin.readline())
finally:
    termios.tcsetattr(sys.stdin.fileno(), termios.TCSANOW, previous)

remote = urlparse(credential['remote_url'])
if remote.scheme != 'https' or remote.username or remote.password:
    raise SystemExit('Expected a credential-free HTTPS source remote')
if credential['auth_mode'] != 'http_extra_header':
    raise SystemExit('Unsupported source authentication mode')
env = dict(os.environ)
for name in list(env):
    if name.startswith('GIT_TRACE') or name.startswith('GIT_CONFIG') or name == 'GIT_CURL_VERBOSE':
        env.pop(name)
env.update({
    'GIT_TERMINAL_PROMPT': '0',
    'GIT_CONFIG_COUNT': '2',
    'GIT_CONFIG_KEY_0': 'http.' + credential['remote_url'] + '.extraHeader',
    'GIT_CONFIG_VALUE_0': 'Authorization: Bearer ' + credential['token'],
    'GIT_CONFIG_KEY_1': 'credential.helper',
    'GIT_CONFIG_VALUE_1': '',
})
def git(*args):
    result = subprocess.run(['git', *args], cwd=root, env=env, text=True, capture_output=True)
    if result.returncode:
        # Error output is intentionally withheld: network debug diagnostics may
        # contain authentication headers. Only the failing public command is shown.
        raise SystemExit('Git operation failed: ' + args[0] + ' (exit ' + str(result.returncode) + ')')
    return result.stdout.strip()

if not (root / '.git').exists():
    git('init', '-b', credential['branch'])
    git('config', 'user.name', 'SHELL Development')
    git('config', 'user.email', 'development@shell.invalid')
    git('remote', 'add', 'origin', credential['remote_url'])
if git('remote', 'get-url', 'origin') != credential['remote_url']:
    raise SystemExit('Source repository differs from this Site credential')
if git('branch', '--show-current') != credential['branch']:
    raise SystemExit('Source branch differs from this Site credential')
git('add', '.openai/hosting.json', 'dist')
if git('status', '--porcelain'):
    git('commit', '-m', 'Publish SHELL Mainnet release preparation and isolated Devnet vault')
commit = git('rev-parse', 'HEAD')
git('push', 'origin', 'HEAD:refs/heads/' + credential['branch'])
pushed = git('ls-remote', 'origin', 'refs/heads/' + credential['branch']).split()[0]
if pushed != commit:
    raise SystemExit('Remote source does not match the local commit')
archive = '/workspace/shell-site-deployment.tar.gz'
git('archive', '--format=tar.gz', '--output=' + archive, commit, '.openai/hosting.json', 'dist')
print(json.dumps({'project_id': manifest['project_id'], 'commit_sha': commit, 'archive': archive}), flush=True)
