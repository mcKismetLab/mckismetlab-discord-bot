import { ButtonInteraction, CacheType, Client, GuildMember, Interaction, MessageActionRow, MessageButton, MessageComponentInteraction, MessageEmbed, MessageSelectMenu, TextChannel } from "discord.js";
import { Modal, TextInputComponent, showModal } from "discord-modals";
import { environment } from "../environment/Environment";
import { ModalSubmitInteraction } from "discord-modals";

import ApiService from "../api/ApiService";
import IWhitelistUser from "../interface/IWhitelistUser";
import Store from "../store/Store";
import SubscriptionEvent from "../subscription/SubscriptionEvent";
import MojangApi from "../api/MojangApi";
import LoggerUtil from "../utils/LoggerUtil";
import Embeds from "../utils/Embeds";

enum VerifyReturnEnum {
    minecraftNameUnknown = 0,
    discordUserUnknown = 1,
    minecraftNameAndDiscordUserUnknown = 2,
    violation = 3,
    success = 4,
    error = 5,
    serverEconnrefused = 6
}

export default class WhitelistApply {

    private static readonly _applyUserData = new Map<string, { serverId: string, minecraftName: string | null, interaction: Interaction }>();
    private static readonly _logger = new LoggerUtil("WhitelistApply");
    private static _store: Store;
    private static _client: Client;
    private static readonly _whitelistNumber = 60;

    constructor(client: Client, store: Store) {
        WhitelistApply._client = client;
        WhitelistApply._store = store;
    }

    public init(): void {
        this._applyEmbed();
    }

    private async _applyEmbed() {

        let allServerWhitelist: Array<IWhitelistUser> | null = null;

        try {
            allServerWhitelist = await ApiService.getAllServerWhitelist();
        } catch (error: any) {
            allServerWhitelist = null;
        }

        let mainServerWhitelist: Array<IWhitelistUser> | null = null;
        if (allServerWhitelist !== null) mainServerWhitelist = allServerWhitelist.filter((value) => value.server_id === "mckismetlab-main-server");

        const embed = new MessageEmbed()
            .setTitle("???? ???????????????????????? (BOT) ????")
            .setDescription("???????????????????????????????????? <@177388464948510720> ??????????????????")
            .setColor("#2894FF")
            .setFooter({
                text: "MCKISMETLAB ??????????????? | ???????????? ??? ????????????",
                iconURL: WhitelistApply._client.user?.avatarURL() as string
            })
            .setFields(
                {
                    name: `???????????????`,
                    value: mainServerWhitelist !== null ? mainServerWhitelist.length.toString() : "????????????",
                    inline: true
                },
                {
                    name: "????????????(?????????)",
                    value: mainServerWhitelist !== null ? (WhitelistApply._whitelistNumber - mainServerWhitelist.length).toString() : "????????????",
                    inline: true
                },
                {
                    name: "????????????",
                    value: WhitelistApply._store.getWhitelistApplyState() ? "?????????" : "??????",
                    inline: true
                }
            )

        const row = new MessageActionRow()
            .addComponents(
                new MessageButton()
                    .setCustomId("WHITELIST_APPLY")
                    .setLabel("???????????????")
                    .setStyle("PRIMARY")
                    .setDisabled(!WhitelistApply._store.getWhitelistApplyState()),
                new MessageButton()
                    .setCustomId("SEARCH_WHITELIST")
                    .setLabel("???????????????")
                    .setStyle("SECONDARY"),
                new MessageButton()
                    .setCustomId("WAIT_WHITELIST_NOTICE")
                    .setLabel("????????????????????????")
                    .setStyle("SECONDARY")
            );

        const channel = WhitelistApply._client.channels.cache.get(environment.whitelistApply.channelId) as TextChannel;
        const messageId = WhitelistApply._store.getWhitelistApplyMessageId();

        if (channel === undefined) throw new Error("Channel not null.");

        if (messageId !== null) {

            const message = (await channel.messages.fetch()).find(value => value.id === messageId);
            if (message === undefined) throw new Error("Message not null.");

            message.edit({ embeds: [embed], components: [row] });

        } else {

            const messageObj = await channel.send({ embeds: [embed], components: [row] });
            WhitelistApply._store.setWhitelistApplyMessageId(messageObj.id);
            WhitelistApply._store.save();

        }
    }

    public static updateApplyEmbed() {
        new WhitelistApply(this._client, this._store)._applyEmbed();
    }

    public static setWhitelistStatus(state: boolean) {
        this._store.setWhitelistApplyState(state);
        this._store.save();
        this.updateApplyEmbed();
    }

    public static async getWaitWhitelistNotices(interaction: ButtonInteraction) {

        const member = interaction.member;
        if (member === null) throw new Error("Member not null.");
        const guild = interaction.guild
        if (guild === null) throw new Error("Guild not null.");
        const waitWhitelistNoticesRole = guild.roles.cache.get(environment.waitWhitelistNoticesRole.roleId);
        if (waitWhitelistNoticesRole === undefined) throw new Error("waitWhitelistNoticesRole not null.");

        const isWaitWhitelistNoticesRole = (member as GuildMember).roles.cache.get(waitWhitelistNoticesRole.id) !== undefined;
        if(isWaitWhitelistNoticesRole) {
            await (member as GuildMember).roles.remove(waitWhitelistNoticesRole);
            interaction.reply({ ephemeral: true, content: "??? ????????? ***????????????????????????*** ????????????" });
        } else {
            await (member as GuildMember).roles.add(waitWhitelistNoticesRole);
            interaction.reply({ ephemeral: true, content: "??? ????????? ***????????????????????????*** ????????????" });
        }
    }

    public static async apply(interaction: ButtonInteraction<CacheType>) {

        await interaction.deferReply({ ephemeral: true });

        if (!this._store.getWhitelistApplyState()) {
            interaction.editReply({ content: "???? ???????????????????????????????????????????????????????????????????????????Discord?????????" });
            return;
        }

        const serverId = "mckismetlab-main-server";
        const userId = interaction.user.id;
        const member = interaction.member as GuildMember;
        let userMinecraftPlayerName: string | null = null;

        try {

            const userLink = await ApiService.getUserLink(userId);

            if (userLink !== null) {

                const userWhitelist = await ApiService.getServerWhitelist(userLink.minecraft_uuid);

                if (userWhitelist !== null) {
                    const mainUserWhitelist = userWhitelist.find((value) => value.server_id === serverId);
                    if (mainUserWhitelist !== undefined) {
                        interaction.editReply({ content: "??? ???????????????????????????????????????????????? ???" });
                        return;
                    }
                }

                // Get minecraft player name
                const playerNames = await MojangApi.getPlayerName(userLink.minecraft_uuid);
                if (playerNames !== null) userMinecraftPlayerName = playerNames[playerNames.length - 1] !== undefined ? playerNames.pop()?.name as string : null;
            }

        } catch (error: any) {
            if (error.error === "server_econnrefused") {
                const embed = Embeds.apiServerOfflineEmbed();
                interaction.editReply({ embeds: [embed] });
                return;
            }
            return;
        }

        const rowSelectMenu = new MessageActionRow()
            .addComponents(
                new MessageSelectMenu()
                    .setCustomId("WHITELIST_APPLY_SELECT_SERVER")
                    .setPlaceholder("??????????????????")
                    .addOptions([
                        {
                            label: "?????????????????????",
                            description: "???????????????????????????????????????",
                            value: "mckismetlab-main-server",
                            default: true
                        }
                    ])
            );

        const rowButton = new MessageActionRow()
            .addComponents(
                new MessageButton()
                    .setCustomId("WHITELIST_APPLY_EDIT_MINECRAFT_NAME")
                    .setLabel("?????? Minecraft ?????????")
                    .setStyle("PRIMARY"),
                new MessageButton()
                    .setCustomId("WHITELIST_APPLY_CANCEL")
                    .setLabel("????????????")
                    .setStyle("DANGER"),
                new MessageButton()
                    .setCustomId("WHITELIST_APPLY_CONFIRM")
                    .setLabel("????????????")
                    .setStyle("SUCCESS")
            )

        const applyUserData = this._applyUserData.get(interaction.user.id);
        if (applyUserData !== undefined) {
            (applyUserData.interaction as ButtonInteraction).editReply({ embeds: [], content: "????????????????????????????????????????????????????????????????????????", components: [] });
        }

        // reply apply
        interaction.editReply({ embeds: [this._applyUserContentEmbed(member, userMinecraftPlayerName)], components: [rowSelectMenu, rowButton] });
        this._applyUserData.set(interaction.user.id, { serverId: "mckismetlab-main-server", minecraftName: userMinecraftPlayerName, interaction: interaction });

        // subscription WHITELIST_APPLY_EDIT_MINECRAFT_NAME
        const subscriptionEditMinecraftNameEvent = new SubscriptionEvent("WHITELIST_APPLY_EDIT_MINECRAFT_NAME", interaction.user.id);
        subscriptionEditMinecraftNameEvent.subscription((client, inter: ButtonInteraction) => {

            if (inter.user.id !== interaction.user.id) return;

            // create model
            const modal = new Modal()
                .setCustomId("WHITELIST_APPLY_MODAL_EDIT_MINECRAFT_NAME")
                .setTitle("???????????????")
                .addComponents(
                    new TextInputComponent()
                        .setCustomId("MINECRAFT_NAME")
                        .setLabel("?????? Minecraft Name")
                        .setStyle("SHORT")
                        .setPlaceholder("????????? Minecraft Name")
                        .setRequired(true)
                );

            showModal(modal, {
                client: client,
                interaction: inter
            });
        });

        // subscription WHITELIST_APPLY_MODAL_EDIT_MINECRAFT_NAME
        const subscriptionChangeMinecraftNameEvent = new SubscriptionEvent("WHITELIST_APPLY_MODAL_EDIT_MINECRAFT_NAME", interaction.user.id);
        subscriptionChangeMinecraftNameEvent.subscription(async (client, modal: ModalSubmitInteraction) => {

            if (modal.user.id !== interaction.user.id) return;

            const applyUserData = this._applyUserData.get(modal.user.id);
            if (applyUserData !== undefined) {
                this._applyUserData.delete(modal.user.id);
                applyUserData.minecraftName = modal.getTextInputValue("MINECRAFT_NAME");
                this._applyUserData.set(modal.user.id, applyUserData);
                modal.update({ embeds: [this._applyUserContentEmbed(member, applyUserData.minecraftName)], components: [rowSelectMenu, rowButton] });
            }

        });

        const subscriptionApplyCancelEvent = new SubscriptionEvent("WHITELIST_APPLY_CANCEL", interaction.user.id);
        const subscriptionApplyConfirmEvent = new SubscriptionEvent("WHITELIST_APPLY_CONFIRM", interaction.user.id);

        // subscription WHITELIST_APPLY_CANCEL
        subscriptionApplyCancelEvent.subscription(async (client, inter: ButtonInteraction) => {

            if (inter.user.id !== interaction.user.id) return;

            // remove subscription event
            subscriptionEditMinecraftNameEvent.delete();
            subscriptionChangeMinecraftNameEvent.delete();
            subscriptionApplyConfirmEvent.delete();
            subscriptionApplyCancelEvent.delete();

            this._applyUserData.delete(inter.user.id);

            const embed = new MessageEmbed()
                .setColor("#2894FF")
                .setDescription("???? ???????????????????????????");

            inter.update({ embeds: [embed], components: [] });
        });

        // subscription WHITELIST_APPLY_CONFIRM
        subscriptionApplyConfirmEvent.subscription(async (client, inter: ButtonInteraction) => {

            if (inter.user.id !== interaction.user.id) return;

            const applyUserData = this._applyUserData.get(inter.user.id);
            if (applyUserData === undefined) throw new Error("ApplyUserData not null.");
            const minecraftName = applyUserData.minecraftName;

            if (minecraftName === null) {
                inter.update({ content: "??? Minecraft ?????????????????????", embeds: [this._applyUserContentEmbed(member, null)], components: [rowSelectMenu, rowButton] });
                return;
            }

            // remove subscription event
            subscriptionEditMinecraftNameEvent.delete();
            subscriptionChangeMinecraftNameEvent.delete();
            subscriptionApplyConfirmEvent.delete();

            const embed = new MessageEmbed()
                .setColor("#2894FF")
                .setDescription("???? ?????????????????????????????????Bot???????????????\n(??????????????????????????????????????????????????????????????????????????????Bot??????????????????)");

            await inter.update({ content: null, embeds: [embed], components: [] });

            // verify
            const verify = await this._verify(client, minecraftName, inter.user.id);
            this._applyUserData.delete(inter.user.id);

            if (verify.verifyState === VerifyReturnEnum.serverEconnrefused) {
                const embed = Embeds.apiServerOfflineEmbed();
                interaction.editReply({ embeds: [embed] });
                return;
            }

            if (verify.verifyState === VerifyReturnEnum.error) {
                const embed = new MessageEmbed()
                    .setDescription("???????????????Bot???????????????????????????????????????\n??????????????????????????????????????? <@177388464948510720> ?????????????????????")
                    .setColor("#2894FF");
                interaction.editReply({ embeds: [embed] });
                return;
            }

            if (verify.verifyState === VerifyReturnEnum.success) {
                const embed = new MessageEmbed()
                    .setTitle(`???? ???! ???????????? ${member.user.username} ?????????????????????????????? ????`)
                    .setFooter({
                        text: "MCKISMETLAB ??????????????? | ???????????? ??? ????????????",
                        iconURL: client.user?.avatarURL() as string
                    })
                    .setColor("#7289DA")
                    .addFields(
                        {
                            name: "???? ?????????????????????:",
                            value: "??????????????????????????????! ???????????? mckismetlab.net ????????????????????????????????????????????????????????????????????????????????????????????????"
                        },
                        {
                            name: "???? ???????????????:",
                            value: "[???????????? -> ?????????????????????](https://mckismetlab.net/)"
                        },
                        {
                            name: "???? ????????? IP:",
                            value: "mckismetlab.net"
                        }
                    )
                interaction.user.send({ embeds: [embed] })
                    .catch(() => this._logger.warn(`Bot?????????????????????DM - ${interaction.user.tag}`));

                try {

                    const allServerWhitelist = await ApiService.getAllServerWhitelist();
                    if (allServerWhitelist !== null) {
                        if (allServerWhitelist.length >= this._whitelistNumber) {
                            this._store.setWhitelistApplyState(false);
                            this._store.save();
                        }
                    }

                } catch (error: any) {
                    this._logger.warn("???????????????????????????????????????");
                }

                this.updateApplyEmbed();
            }

            if (verify.verifyState === VerifyReturnEnum.minecraftNameUnknown) {
                const embed = new MessageEmbed()
                    .setTitle("??? ???????????????????????????????????????! ???")
                    .setFooter({
                        text: "MCKISMETLAB ??????????????? | ???????????? ??? ????????????",
                        iconURL: client.user?.avatarURL() as string
                    })
                    .setColor("#FF0000")
                    .addFields(
                        {
                            name: "??? ????????????:",
                            value: "?????? Minecraft Name ???????????????"
                        },
                        {
                            name: "???? ????????????????????????:",
                            value: "???????????? <@177388464948510720> ?????????????????????"
                        }
                    )
                interaction.user.send({ embeds: [embed] })
                    .catch(() => this._logger.warn(`Bot?????????????????????DM - ${interaction.user.tag}`));
            }

            // TODO: VerifyReturnEnum.violation

            this._discordLogNotice(client, verify.verifyState, minecraftName, verify.minecraftUuid, inter);
        });
    }

    private static async _verify(client: Client, minecraftName: string, discordUserId: string): Promise<{ verifyState: VerifyReturnEnum, minecraftUuid: string | null }> {
        try {

            // ????????????????????? minecraft name OR ????????? minecraft name
            const minecraftProfilesUser = await MojangApi.validateSpieler(minecraftName);

            // ????????????????????? discord
            const discordUser = client.users.cache.get(discordUserId);

            if (minecraftProfilesUser === null && discordUser === null) {
                return {
                    verifyState: VerifyReturnEnum.minecraftNameAndDiscordUserUnknown,
                    minecraftUuid: null
                };
            }

            if (minecraftProfilesUser === null) {
                return {
                    verifyState: VerifyReturnEnum.minecraftNameUnknown,
                    minecraftUuid: null
                };
            }

            if (discordUser === null) {
                return {
                    verifyState: VerifyReturnEnum.discordUserUnknown,
                    minecraftUuid: minecraftProfilesUser.id
                };
            }

            // ??????????????????????????? violation ?????????
            const violationDiscord = await ApiService.getViolation(discordUserId);
            const violationMinecraft = await ApiService.getViolation(minecraftProfilesUser.id);

            // ???????????????????????????
            if (violationDiscord !== null || violationMinecraft !== null) {
                return {
                    verifyState: VerifyReturnEnum.violation,
                    minecraftUuid: minecraftProfilesUser.id
                };
            }

            // ??????????????????????????? code

            await ApiService.createUserLink(minecraftProfilesUser.id, discordUserId);
            await ApiService.createServerWhitelist({
                minecraft_uuid: minecraftProfilesUser.id,
                server_id: this._applyUserData.get(discordUserId)?.serverId
            });

            const guild = client.guilds.cache.get(environment.guilds_id);
            if (guild === undefined) throw new Error("Guild not null.");
            const member = guild.members.cache.get(discordUserId);
            if (member === undefined) throw new Error("Member not null.");
            const roleWhitelist = guild.roles.cache.get(environment.roleWhitelist.roleId);
            if (roleWhitelist === undefined) throw new Error("RoleWhitelist not null.");

            // discord user add whitelist role
            await member.roles.add(roleWhitelist);

            // discord user remove waitWhitelistNotices role
            const waitWhitelistNoticesRole = guild.roles.cache.get(environment.waitWhitelistNoticesRole.roleId);
            if(waitWhitelistNoticesRole !== undefined) {
                await member.roles.remove(waitWhitelistNoticesRole);
            }

            return {
                verifyState: VerifyReturnEnum.success,
                minecraftUuid: minecraftProfilesUser.id
            };

        } catch (error: any) {

            if (error.error === "server_econnrefused") {
                return {
                    verifyState: VerifyReturnEnum.serverEconnrefused,
                    minecraftUuid: null
                };
            }

            this._logger.error(error);
            return {
                verifyState: VerifyReturnEnum.error,
                minecraftUuid: null
            };
        }
    }

    private static _discordLogNotice(client: Client, verifyState: VerifyReturnEnum, minecraftName: string, minecraftUuid: string | null, interaction: MessageComponentInteraction) {

        let autoAuditResults: "????????????" | "??????" | "?????????" | null = null;
        let description: string | null = null;
        let color: "#0779E8" | "#FEB63F" | "#FF4F42" | "#7289DA" = "#7289DA";

        if (verifyState === VerifyReturnEnum.success) {
            autoAuditResults = "??????";
            color = "#0779E8";
        }

        if (verifyState === VerifyReturnEnum.minecraftNameUnknown) {
            autoAuditResults = "????????????";
            description = "Minecraft Name ????????????"
            color = "#FF4F42";
        }

        const embed = new MessageEmbed()
            .setTitle(`**???????????? (BETA) ????????????: ${autoAuditResults}**`)
            .setColor(color)
            .addFields(
                {
                    name: "Minecraft ??????",
                    value: minecraftName
                },
                {
                    name: "Minecraft UUID",
                    value: minecraftUuid !== null ? minecraftUuid : "???"
                },
                {
                    name: "Discord ??????",
                    value: interaction.user.tag
                },
                {
                    name: "Discord ID",
                    value: interaction.user.id
                },
                {
                    name: "??????:",
                    value: description !== null ? description : "???"
                });

        const channel = client.channels.cache.get(environment.verifyDiscordNoticeChannelId) as TextChannel;
        channel.send({ embeds: [embed] });
    }

    public static _applyUserContentEmbed(member: GuildMember, minecraftPlayerName: string | null) {

        const embed = new MessageEmbed()
            .setTitle(`????  ???????????????????????? (BOT) ????????????`)
            // .setDescription("")
            .setFields(
                {
                    name: "Minecraft ?????????",
                    value: minecraftPlayerName !== null ? minecraftPlayerName : "?????????????????? Minecraft ?????????",
                    inline: true
                },
                {
                    name: "Discord ?????????",
                    value: member.user.username,
                    inline: true
                },
                { // TODO:
                    name: "???????????????",
                    value: "?????????????????????",
                    inline: true
                }
            )

        return embed;
    }
}