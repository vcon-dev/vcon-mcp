---
description: A quick start to getting the conserver up and running
---

# 🐰 Conserver Quick Start

## Ubuntu Install&#x20;

Based on a digital ocean install, to keep it vanilla. Created a 4 GB Memory / 2 Intel vCPUs / 120 GB Disk / NYC3 - Ubuntu 23.04 x64 droplet, logged in.

```
snap install docker
git clone https://github.com/vcon-dev/vcon.git
cd vcon/
git submodule sync
git submodule update --init --recursive
cd vcon-server/
git checkout main
cd ..
cd vcon-admin/
git checkout main
cd ..
```

## Conserver Start

The conserver repo [can be downloaded directly](https://github.com/vcon-dev/vcon-server), but is also included in the vcon repo in the von-server directory.

```
cd vcon-server
```

Create an \~/vcon/.env file.  See example .env below. \*Note that the default URL for REDIS assumes it is running in a docker container, thus the hostname "redis".

```
REDIS_URL=redis://redis

# Leave this blank to disable API security
# You set this before opening the port in your firewall
CONSERVER_API_TOKEN=

# to customize the config copy example_config.yml to config.yml
# modify the values in config.yml as needed
# and set CONSERVER_CONFIG_FILE to ./config.yml below
CONSERVER_CONFIG_FILE=config.yml
```



## Example vcon-server/config.yml

Most of the configuration is done through the config.yml file. Here's a very simple one. Inbound vCons in the ingress chain cause a slack webhook into a workflow, then it will be stored in mongo.

```
links:
  tag:
    module: links.tag
    ingress-lists: []
    egress-lists: []
    options:
      tags:
      - smart_trunk_ingress
  
storages:
  mongo:
    module: storage.mongo
    options:
      url: mongodb://root:example@mongo:27017/
      database: conserver
      collection: vcons
chains:
  demo_chain:
    ingress_lists:
    - ingress
    links:
    - tag
    storages:
    - mongo
    enabled: 1
```

### Standalone Operation

When running a conserver in "standalone mode" (using vcon-admin as a simple portal, which will also provide the basic versions of all of the apps and databases), it will automatically register a domain name and generate a valid SSL certificate using LetsEncrypt, assuming that the domain name has an A record pointing to your server.

```
export DNS_REGISTRATION_EMAIL=mulligan.mccarthy@strolid.com
export DNS_HOST=mulligan.strolid.net
```

### Start the Conserver

```
docker network create conserver
docker compose build
docker compose up
docker compose up --scale conserver=4 -d
```

## Troubleshooting and Checking

You can validate that the conserver is running on the command line using "docker ps".  In the example below, we can see four instances running.

```
root@partner-demo:~/vcon/vcon-server# docker ps
CONTAINER ID   IMAGE                      COMMAND                  CREATED         STATUS                   PORTS                                                 NAMES
21bc6e3aacd7   vcon-server-conserver      "/app/docker/wait_fo…"   4 minutes ago   Up 4 minutes                                                                   vcon-server-conserver-4
2e3a0341043d   vcon-server-conserver      "/app/docker/wait_fo…"   4 minutes ago   Up 4 minutes                                                                   vcon-server-conserver-2
9c699287f035   vcon-server-conserver      "/app/docker/wait_fo…"   4 minutes ago   Up 4 minutes                                                                   vcon-server-conserver-3
ffe6f68941c8   vcon-server-conserver      "/app/docker/wait_fo…"   5 minutes ago   Up 5 minutes                                                                   vcon-server-conserver-1
8136e15912c5   vcon-server-api            "/app/docker/wait_fo…"   5 minutes ago   Up 5 minutes             0.0.0.0:8000->8000/tcp, :::8000->8000/tcp             vcon-server-api-1
e3388b5f23be   redis/redis-stack:latest   "/entrypoint.sh"         5 minutes ago   Up 5 minutes (healthy)   6379/tcp, 0.0.0.0:8001->8001/tcp, :::8001->8001/tcp   vcon-server-redis-1
root@partner-demo:~/vcon/vcon-server# 
```

You can see the operational logs using "docker compose logs -f".  Here's a typical log:

```
vcon-server-redis-1      | 9:C 23 Aug 2024 17:27:20.581 # WARNING Memory overcommit must be enabled! Without it, a background save or replication may fail under low memory condition. Being disabled, it can also cause failures without low memory condition, see https://github.com/jemalloc/jemalloc/issues/1328. To fix this issue add 'vm.overcommit_memory = 1' to /etc/sysctl.conf and then reboot or run the command 'sysctl vm.overcommit_memory=1' for this to take effect.
vcon-server-redis-1      | 9:C 23 Aug 2024 17:27:20.582 * oO0OoO0OoO0Oo Redis is starting oO0OoO0OoO0Oo
vcon-server-redis-1      | 9:C 23 Aug 2024 17:27:20.582 * Redis version=7.4.0, bits=64, commit=00000000, modified=0, pid=9, just started
vcon-server-redis-1      | 9:C 23 Aug 2024 17:27:20.582 * Configuration loaded
vcon-server-redis-1      | 9:M 23 Aug 2024 17:27:20.582 * Increased maximum number of open files to 10032 (it was originally set to 1024).
vcon-server-redis-1      | 9:M 23 Aug 2024 17:27:20.583 * monotonic clock: POSIX clock_gettime
vcon-server-redis-1      | 9:M 23 Aug 2024 17:27:20.584 * Running mode=standalone, port=6379.
vcon-server-redis-1      | 9:M 23 Aug 2024 17:27:20.586 * Module 'RedisCompat' loaded from /opt/redis-stack/lib/rediscompat.so
vcon-server-redis-1      | 9:M 23 Aug 2024 17:27:20.614 * <search> Redis version found by RedisSearch : 7.4.0 - oss
vcon-server-redis-1      | 9:M 23 Aug 2024 17:27:20.616 * <search> RediSearch version 2.10.5 (Git=2.10-e2f28a9)
vcon-server-redis-1      | 9:M 23 Aug 2024 17:27:20.616 * <search> Low level api version 1 initialized successfully
vcon-server-redis-1      | 9:M 23 Aug 2024 17:27:20.617 * <search> gc: ON, prefix min length: 2, min word length to stem: 4, prefix max expansions: 200, query timeout (ms): 500, timeout policy: return, cursor read size: 1000, cursor max idle (ms): 300000, max doctable size: 1000000, max number of search results:  10000, 
vcon-server-redis-1      | 9:M 23 Aug 2024 17:27:20.620 * <search> Initialized thread pools!
vcon-server-redis-1      | 9:M 23 Aug 2024 17:27:20.621 * <search> Enabled role change notification
vcon-server-redis-1      | 9:M 23 Aug 2024 17:27:20.621 * Module 'search' loaded from /opt/redis-stack/lib/redisearch.so
vcon-server-redis-1      | 9:M 23 Aug 2024 17:27:20.630 * <timeseries> RedisTimeSeries version 11202, git_sha=5643fd4d6fcb1e9cf084fb2deb9285b08f4a6672
vcon-server-redis-1      | 9:M 23 Aug 2024 17:27:20.631 * <timeseries> Redis version found by RedisTimeSeries : 7.4.0 - oss
vcon-server-redis-1      | 9:M 23 Aug 2024 17:27:20.631 * <timeseries> loaded default CHUNK_SIZE_BYTES policy: 4096
vcon-server-redis-1      | 9:M 23 Aug 2024 17:27:20.631 * <timeseries> loaded server DUPLICATE_POLICY: block
vcon-server-redis-1      | 9:M 23 Aug 2024 17:27:20.631 * <timeseries> loaded default IGNORE_MAX_TIME_DIFF: 0
vcon-server-redis-1      | 9:M 23 Aug 2024 17:27:20.631 * <timeseries> loaded default IGNORE_MAX_VAL_DIFF: 0.000000
vcon-server-redis-1      | 9:M 23 Aug 2024 17:27:20.631 * <timeseries> Setting default series ENCODING to: compressed
vcon-server-redis-1      | 9:M 23 Aug 2024 17:27:20.631 * <timeseries> Detected redis oss
vcon-server-redis-1      | 9:M 23 Aug 2024 17:27:20.631 * Module 'timeseries' loaded from /opt/redis-stack/lib/redistimeseries.so
vcon-server-redis-1      | 9:M 23 Aug 2024 17:27:20.639 * <ReJSON> Created new data type 'ReJSON-RL'
vcon-server-redis-1      | 9:M 23 Aug 2024 17:27:20.639 * <ReJSON> version: 20803 git sha: unknown branch: unknown
vcon-server-redis-1      | 9:M 23 Aug 2024 17:27:20.639 * <ReJSON> Exported RedisJSON_V1 API
vcon-server-redis-1      | 9:M 23 Aug 2024 17:27:20.639 * <ReJSON> Exported RedisJSON_V2 API
vcon-server-redis-1      | 9:M 23 Aug 2024 17:27:20.639 * <ReJSON> Exported RedisJSON_V3 API
vcon-server-redis-1      | 9:M 23 Aug 2024 17:27:20.639 * <ReJSON> Exported RedisJSON_V4 API
vcon-server-redis-1      | 9:M 23 Aug 2024 17:27:20.639 * <ReJSON> Exported RedisJSON_V5 API
vcon-server-redis-1      | 9:M 23 Aug 2024 17:27:20.639 * <ReJSON> Enabled diskless replication
vcon-server-redis-1      | 9:M 23 Aug 2024 17:27:20.639 * Module 'ReJSON' loaded from /opt/redis-stack/lib/rejson.so
vcon-server-redis-1      | 9:M 23 Aug 2024 17:27:20.639 * <search> Acquired RedisJSON_V5 API
vcon-server-redis-1      | 9:M 23 Aug 2024 17:27:20.641 * <bf> RedisBloom version 2.8.2 (Git=unknown)
vcon-server-redis-1      | 9:M 23 Aug 2024 17:27:20.641 * Module 'bf' loaded from /opt/redis-stack/lib/redisbloom.so
vcon-server-redis-1      | 9:M 23 Aug 2024 17:27:20.648 * <redisgears_2> Created new data type 'GearsType'
vcon-server-redis-1      | 9:M 23 Aug 2024 17:27:20.650 * <redisgears_2> Detected redis oss
vcon-server-redis-1      | 9:M 23 Aug 2024 17:27:20.652 # <redisgears_2> could not initialize RedisAI_InitError
vcon-server-redis-1      | 
vcon-server-redis-1      | 
vcon-server-redis-1      | 9:M 23 Aug 2024 17:27:20.652 * <redisgears_2> Failed loading RedisAI API.
vcon-server-redis-1      | 9:M 23 Aug 2024 17:27:20.652 * <redisgears_2> RedisGears v2.0.20, sha='9b737886bf825fe29ddc2f8da81f73cbe0b4e858', build_type='release', built_for='Linux-ubuntu22.04.x86_64', redis_version:'7.4.0', enterprise:'false'.
vcon-server-redis-1      | 9:M 23 Aug 2024 17:27:20.657 * <redisgears_2> Registered backend: js.
vcon-server-redis-1      | 9:M 23 Aug 2024 17:27:20.657 * Module 'redisgears_2' loaded from /opt/redis-stack/lib/redisgears.so
vcon-server-redis-1      | 9:M 23 Aug 2024 17:27:20.657 * Server initialized
vcon-server-redis-1      | 9:M 23 Aug 2024 17:27:20.657 * Ready to accept connections tcp
vcon-server-conserver-2  | Redis is ready!
vcon-server-conserver-2  | Redis is ready. Starting the dependent service...
vcon-server-conserver-2  | {"asctime": "2024-08-23 17:28:24,696", "levelname": "INFO", "name": "__main__", "message": "Starting main loop", "taskName": null}
vcon-server-conserver-4  | Redis is ready!
vcon-server-conserver-4  | Redis is ready. Starting the dependent service...
vcon-server-conserver-4  | {"asctime": "2024-08-23 17:28:24,545", "levelname": "INFO", "name": "__main__", "message": "Starting main loop", "taskName": null}
vcon-server-conserver-3  | Redis is ready!
vcon-server-conserver-3  | Redis is ready. Starting the dependent service...
vcon-server-conserver-3  | {"asctime": "2024-08-23 17:28:25,041", "levelname": "INFO", "name": "__main__", "message": "Starting main loop", "taskName": null}
vcon-server-api-1        | Redis is ready!
vcon-server-api-1        | Redis is ready. Starting the dependent service...
vcon-server-api-1        | Skipping virtualenv creation, as specified in config file.
vcon-server-api-1        | {"asctime": "2024-08-23 17:27:24,198", "levelname": "INFO", "name": "server.api", "message": "Api starting up", "taskName": "Task-1"}
vcon-server-api-1        | {"asctime": "2024-08-23 17:27:24,226", "levelname": "INFO", "name": "uvicorn.error", "message": "Started server process [1]", "taskName": "Task-1", "color_message": "Started server process [\u001b[36m%d\u001b[0m]"}
vcon-server-api-1        | {"asctime": "2024-08-23 17:27:24,226", "levelname": "INFO", "name": "uvicorn.error", "message": "Waiting for application startup.", "taskName": "Task-1"}
vcon-server-api-1        | {"asctime": "2024-08-23 17:27:24,227", "levelname": "INFO", "name": "uvicorn.error", "message": "Application startup complete.", "taskName": "Task-1"}
vcon-server-api-1        | {"asctime": "2024-08-23 17:27:24,227", "levelname": "INFO", "name": "uvicorn.error", "message": "Uvicorn running on http://0.0.0.0:8000 (Press CTRL+C to quit)", "taskName": "Task-1", "color_message": "Uvicorn running on \u001b[1m%s://%s:%d\u001b[0m (Press CTRL+C to quit)"}
vcon-server-conserver-1  | Redis is ready!
vcon-server-conserver-1  | Redis is ready. Starting the dependent service...
vcon-server-conserver-1  | {"asctime": "2024-08-23 17:27:22,240", "levelname": "INFO", "name": "__main__", "message": "Starting main loop", "taskName": null}

```

The [vCon admin program](https://github.com/vcon-dev/vcon-admin) is a nice tool for managing the conserver.&#x20;

