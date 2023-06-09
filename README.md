# Live Version

**[Public Bot Link](https://discord.com/api/oauth2/authorize?client_id=993116789284286484&scope=bot+applications.commands&permissions=2100224)**

If you don't want to deploy your own instance via docker or node or just want to test the bot you can use the public instance of the bot at the risk of it being down for a few minutes whenever I update it. I try to only update it at times when there are no wars in EU timezones.  
I will maintain this bot as long as I actively play the game.

# How to use

1. Use the `/create` command in any channel that the bot has read permissions in  
  1.1 *(optional)* add options like managerroles or the target channel (for the widget)
2. Use the play/stop button to start/stop text updates on the widget
3. Use the speaker button to connect the bot to your current voice-channel  
![https://imgur.com/xWCrxRi](https://i.imgur.com/xWCrxRi.png)

# Deployment - Docker
`docker run -d --name wartimer -e DISCORD_CLIENT_TOKEN='<Token>' -e DISCORD_CLIENT_ID='<ID>' realdegrees/wartimer`

**OR**

docker-compose.yml
```yml
version: "3.2"
services:
  wartimer:
    container_name: wartimer
    image: realdegrees/wartimer:latest
    restart: unless-stopped
    environment:
      - DISCORD_CLIENT_TOKEN=<Token>
      - DISCORD_CLIENT_ID=<ID>
```
# Deployment - Node
1. Clone the repo
2. Run `npm install` in `backend`
3. Create `.env` in `backend` with following content:
```
DISCORD_CLIENT_TOKEN="<Token>"
DISCORD_CLIENT_ID="<Token>"
```
4. Run `npm run start:build`

# Dockerizing
You can create your own docker image of this app by running `npm run dockerize` in `backend`.
