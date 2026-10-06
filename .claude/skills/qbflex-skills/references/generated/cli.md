# CLI command reference

Generated from real Commander help for each source-declared command. Source checkout invocation is `bun run qb`. Help extraction does not execute command actions.

## qb --help

```text
Usage: qb [options] [command]

QB Flex project tools

Options:
  -V, --version    output the version number
  -h, --help       display help for command

Commands:
  init             Create local project configuration
  dev              Start the local workspace
  login [options]
  link [options]   Link a project and branch
  projects
  db
  types
  backup
  branches
  storage
  secrets
  help [command]   display help for command
```

## qb init

```text
Usage: qb init [options]

Create local project configuration

Options:
  -h, --help  display help for command
```

## qb dev

```text
Usage: qb dev [options]

Start the local workspace

Options:
  -h, --help  display help for command
```

## qb login

```text
Usage: qb login [options]

Options:
  --url <url>          API URL (default: "http://localhost:7612")
  --email <email>      Platform email
  --organization <id>  Grant project lifecycle access within this organization
  -h, --help           display help for command
```

## qb link

```text
Usage: qb link [options]

Link a project and branch

Options:
  --project <id>  Project ID
  --branch <id>   Branch ID or alias
  --url <url>     API URL
  -h, --help      display help for command
```

## qb projects

```text
Usage: qb projects [options] [command]

Options:
  -h, --help        display help for command

Commands:
  list [options]
  create [options]
  help [command]    display help for command
```

## qb projects list

```text
Usage: qb projects list [options]

Options:
  --url <url>
  -h, --help   display help for command
```

## qb projects create

```text
Usage: qb projects create [options]

Options:
  --organization <id>
  --name <name>
  --slug <slug>
  --url <url>
  -h, --help           display help for command
```

## qb db

```text
Usage: qb db [options] [command]

Options:
  -h, --help         display help for command

Commands:
  migrate [options]
  diff [options]
  reset [options]
  export [options]
  import [options]
  help [command]     display help for command
```

## qb db migrate

```text
Usage: qb db migrate [options]

Options:
  --file <file>
  --id <id>
  --project <id>  Project ID
  --branch <id>   Branch ID or alias
  --url <url>     API URL
  -h, --help      display help for command
```

## qb db diff

```text
Usage: qb db diff [options]

Options:
  --file <file>   Expected schema JSON exported from /schema
  --project <id>  Project ID
  --branch <id>   Branch ID or alias
  --url <url>     API URL
  -h, --help      display help for command
```

## qb db reset

```text
Usage: qb db reset [options]

Options:
  --data-dir <path>      Local disposable data directory
  --confirm-local-reset  Confirm destruction of the local directory
  --project <id>         Project ID
  --branch <id>          Branch ID or alias
  --url <url>            API URL
  -h, --help             display help for command
```

## qb db export

```text
Usage: qb db export [options]

Options:
  --table <name>
  --output <file>
  --project <id>   Project ID
  --branch <id>    Branch ID or alias
  --url <url>      API URL
  -h, --help       display help for command
```

## qb db import

```text
Usage: qb db import [options]

Options:
  --table <name>
  --file <file>
  --project <id>  Project ID
  --branch <id>   Branch ID or alias
  --url <url>     API URL
  -h, --help      display help for command
```

## qb types

```text
Usage: qb types [options] [command]

Options:
  -h, --help          display help for command

Commands:
  generate [options]
  help [command]      display help for command
```

## qb types generate

```text
Usage: qb types generate [options]

Options:
  --output <file>  Output filename (default: "qb-flex.types.ts")
  --project <id>   Project ID
  --branch <id>    Branch ID or alias
  --url <url>      API URL
  -h, --help       display help for command
```

## qb backup

```text
Usage: qb backup [options] [command]

Options:
  -h, --help                 display help for command

Commands:
  control-create [options]
  control-restore [options]
  create [options]
  restore [options]
  help [command]             display help for command
```

## qb backup control-create

```text
Usage: qb backup control-create [options]

Options:
  --data-dir <directory>  Stopped local API data directory
  -h, --help              display help for command
```

## qb backup control-restore

```text
Usage: qb backup control-restore [options]

Options:
  --data-dir <directory>
  --file <archive>
  --confirm-local-control-restore  Replace the stopped control catalog and
                                   revoke credentials
  -h, --help                       display help for command
```

## qb backup create

```text
Usage: qb backup create [options]

Options:
  --project <id>  Project ID
  --branch <id>   Branch ID or alias
  --url <url>     API URL
  -h, --help      display help for command
```

## qb backup restore

```text
Usage: qb backup restore [options]

Options:
  --backup <id>
  --project <id>  Project ID
  --branch <id>   Branch ID or alias
  --url <url>     API URL
  -h, --help      display help for command
```

## qb branches

```text
Usage: qb branches [options] [command]

Options:
  -h, --help      display help for command

Commands:
  list [options]
  help [command]  display help for command
```

## qb branches list

```text
Usage: qb branches list [options]

Options:
  --project <id>  Project ID
  --branch <id>   Branch ID or alias
  --url <url>     API URL
  -h, --help      display help for command
```

## qb storage

```text
Usage: qb storage [options] [command]

Options:
  -h, --help      display help for command

Commands:
  list [options]
  sync [options]
  help [command]  display help for command
```

## qb storage list

```text
Usage: qb storage list [options]

Options:
  --project <id>  Project ID
  --branch <id>   Branch ID or alias
  --url <url>     API URL
  -h, --help      display help for command
```

## qb secrets

```text
Usage: qb secrets [options] [command]

Options:
  -h, --help      display help for command

Commands:
  set [options]
  help [command]  display help for command
```

## qb secrets set

```text
Usage: qb secrets set [options]

Options:
  --name <name>     Secret name
  --env <variable>  Environment variable containing its value
  --project <id>    Project ID
  --branch <id>     Branch ID or alias
  --url <url>       API URL
  -h, --help        display help for command
```

## qb storage sync

```text
Usage: qb storage sync [options]

Options:
  --bucket <id>
  --directory <path>
  --project <id>      Project ID
  --branch <id>       Branch ID or alias
  --url <url>         API URL
  -h, --help          display help for command
```
