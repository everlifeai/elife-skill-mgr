# The Everlife Skill Manager

An Everlife avatar gets skills, installs, and sets them up ready for
work. This code contains the core ability to do that - communicating
with the work queue in order to register and obtain work.

As with all core components, it exposes a cote.js microservice
partitioned with the key `everlife-skill-svc`.

## Configuration
The configuration has defaults that can be overridden by environment
variables.


## Quick Start
```js
const cote = require('cote')

const client = new cote.Requester({
    name: 'Test SkillMgr Client',
    key: 'everlife-skill-svc',
})

...
client.send({ type: 'add', pkg: 'everlifeai/elife-utils' })
...

```

