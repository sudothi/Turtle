package xyz.ogturtle.turtle.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.automirrored.filled.VolumeUp
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Call
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.MicOff
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Group
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Tag
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.DrawerValue
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalDrawerSheet
import androidx.compose.material3.ModalNavigationDrawer
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.rememberDrawerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.sp
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import xyz.ogturtle.turtle.AppViewModel
import xyz.ogturtle.turtle.activityOf
import xyz.ogturtle.turtle.R
import xyz.ogturtle.turtle.UiState
import xyz.ogturtle.turtle.data.Channel
import xyz.ogturtle.turtle.data.Server
import xyz.ogturtle.turtle.data.VoiceState
import xyz.ogturtle.turtle.data.Unread
import xyz.ogturtle.turtle.data.shownName
import xyz.ogturtle.turtle.data.title
import xyz.ogturtle.turtle.ui.theme.Ink

/** Onde estou: a lista de conversas e amigos (casa), ou um servidor. */
private const val HOME = "home"

@Composable
fun HomeScreen(state: UiState, vm: AppViewModel) {
    // Os diálogos abrem por cima da faixa de erro: eles mostram o erro do servidor por dentro.
    CompositionLocalProvider(LocalDialogError provides DialogError(state.error, vm::clearError)) {
        HomeContent(state, vm)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun HomeContent(state: UiState, vm: AppViewModel) {
    val drawer = rememberDrawerState(DrawerValue.Closed)
    val membersDrawer = rememberDrawerState(DrawerValue.Closed)
    val scope = rememberCoroutineScope()
    var place by rememberSaveable { mutableStateOf(HOME) }
    // Conversa aberta: id do canal. `showFriends` = tela de amigos.
    var openId by rememberSaveable { mutableStateOf<String?>(null) }
    var showFriends by rememberSaveable { mutableStateOf(false) }
    var profileId by rememberSaveable { mutableStateOf<String?>(null) }
    // Conversa cuja tela de chamada está aberta (no lugar do chat).
    var dmCallId by rememberSaveable { mutableStateOf<String?>(null) }

    val unread = state.unread.associateBy { it.channelId }
    val allChannels = state.channels.values.flatten()
    val openChannel = openId?.let { id -> allChannels.firstOrNull { it.id == id } }
    val openDm = openId?.let { id -> state.dms.firstOrNull { it.channelId == id } }
    // Servidor da tela atual: o do canal aberto ou o escolhido na barra de servidores.
    val currentServerId = openChannel?.serverId ?: place.takeIf { it != HOME }
    val title = when {
        showFriends -> "Amigos"
        openChannel != null -> "# ${openChannel.name}"
        openDm != null -> openDm.title
        else -> "Turtle"
    }

    // Trocou de conversa: volta para o chat.
    LaunchedEffect(openId) { if (dmCallId != openId) dmCallId = null }
    // Chamada da conversa: o canal de voz é o próprio canal da conversa.
    val dmCall = openDm?.takeIf { dmCallId == it.channelId }?.let { Channel(it.channelId, "", it.title, "voice") }
    // Avisa o estado qual conversa está na tela (para as não lidas e o histórico).
    LaunchedEffect(openId, showFriends, openChannel?.isVoice) { vm.openChannel(if (showFriends || openChannel?.isVoice == true) null else openId) }
    // Carrega os membros do servidor atual (lista lateral e perfis).
    LaunchedEffect(currentServerId) { currentServerId?.let { if (state.members[it] == null) vm.loadMembers(it) } }
    // Abre a gaveta na primeira vez, para a pessoa ver onde estão os canais.
    LaunchedEffect(Unit) { if (openId == null && !showFriends) drawer.open() }
    // Voltar fecha a gaveta se aberta; senão volta à gaveta a partir de uma conversa.
    BackHandler(enabled = membersDrawer.isOpen) { scope.launch { membersDrawer.close() } }
    BackHandler(enabled = drawer.isOpen) { scope.launch { drawer.close() } }
    BackHandler(enabled = !drawer.isOpen && !membersDrawer.isOpen && (openId != null || showFriends)) { scope.launch { drawer.open() } }

    // Duas gavetas: a de membros fica à direita (layout invertido só para posicionar; o conteúdo volta ao normal).
    CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Rtl) {
        ModalNavigationDrawer(
            drawerState = membersDrawer,
            gesturesEnabled = currentServerId != null,
            scrimColor = Color(0xCC000000),
            drawerContent = {
                CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Ltr) {
                    ModalDrawerSheet(
                        modifier = Modifier.width(300.dp),
                        drawerContainerColor = Ink.Ink1,
                        drawerContentColor = Ink.Paper,
                        windowInsets = WindowInsets(0),
                    ) {
                        MembersPanel(state, vm, currentServerId) { id -> scope.launch { membersDrawer.close() }; profileId = id }
                    }
                }
            },
        ) {
            CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Ltr) {
                ModalNavigationDrawer(
                    drawerState = drawer,
                    gesturesEnabled = true,
                    scrimColor = Color(0xCC000000),
                    drawerContent = {
                        ModalDrawerSheet(
                            modifier = Modifier.width(332.dp),
                            drawerContainerColor = Ink.Ink1,
                            drawerContentColor = Ink.Paper,
                            drawerShape = RoundedCornerShape(topEnd = 0.dp, bottomEnd = 0.dp),
                            windowInsets = WindowInsets(0),
                        ) {
                            Sidebar(
                                state = state,
                                vm = vm,
                                place = place,
                                unread = unread,
                                onPlace = { place = it },
                                onFriends = { showFriends = true; openId = null; scope.launch { drawer.close() } },
                                onOpen = { id -> openId = id; showFriends = false; scope.launch { drawer.close() } },
                            )
                        }
                    },
                ) {
                    Scaffold(
                        containerColor = Ink.Ink2,
                        contentColor = Ink.Paper,
                        topBar = {
                            TopAppBar(
                                title = { Text(title, fontWeight = FontWeight.ExtraBold, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                                navigationIcon = {
                                    IconButton(onClick = { scope.launch { drawer.open() } }) { Icon(Icons.Filled.Menu, contentDescription = "Abrir menu") }
                                },
                                actions = {
                                    if (currentServerId != null) {
                                        IconButton(onClick = { scope.launch { membersDrawer.open() } }) { Icon(Icons.Filled.Group, contentDescription = "Membros") }
                                    } else if (openDm != null) {
                                        IconButton(onClick = { dmCallId = openDm.channelId }) { Icon(Icons.Filled.Call, contentDescription = "Chamada") }
                                        if (!openDm.group) {
                                            IconButton(onClick = { profileId = openDm.users.firstOrNull()?.id }) { Icon(Icons.Filled.Person, contentDescription = "Ver perfil") }
                                        }
                                    }
                                },
                                colors = TopAppBarDefaults.topAppBarColors(
                                    containerColor = Ink.Ink1, titleContentColor = Ink.Paper,
                                    navigationIconContentColor = Ink.Paper, actionIconContentColor = Ink.Paper,
                                ),
                            )
                        },
                    ) { pad ->
                        Column(Modifier.padding(pad).fillMaxSize()) {
                        // Chamadas tocando (DM e grupo): atender abre a tela da chamada, onde está o botão de entrar.
                        state.ringing.forEach { r ->
                            Row(
                                Modifier.fillMaxWidth().background(Ink.Paper).padding(start = 16.dp, end = 4.dp, top = 2.dp, bottom = 2.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Text("${r.fromName} está te ligando${if (r.silent) " (Não perturbe)" else ""}", color = Ink.Ink0, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                                Text(
                                    "Atender", color = Ink.Ink0, fontWeight = FontWeight.ExtraBold,
                                    modifier = Modifier.clickable {
                                        openId = r.channelId; showFriends = false; place = HOME; dmCallId = r.channelId
                                        vm.dismissRing(r.channelId)
                                    }.padding(horizontal = 12.dp, vertical = 10.dp),
                                )
                                Text("Recusar", color = Ink.Ink0, modifier = Modifier.clickable { vm.declineRing(r.channelId) }.padding(horizontal = 12.dp, vertical = 10.dp))
                            }
                        }
                        val call = state.call
                        // Tela de chamada visível agora (canal de voz ou chamada da conversa).
                        val callScreenId = if (showFriends) null else if (openChannel?.isVoice == true) openId else dmCall?.id
                        if (call != null && call.channelId != callScreenId) {
                            val callDm = state.dms.firstOrNull { it.channelId == call.channelId }
                            val callName = allChannels.firstOrNull { it.id == call.channelId }?.name ?: callDm?.title ?: "Chamada"
                            Row(
                                Modifier.fillMaxWidth().background(Ink.Paper).clickable {
                                    openId = call.channelId; showFriends = false
                                    if (callDm != null) { dmCallId = call.channelId; place = HOME }
                                    else place = allChannels.firstOrNull { it.id == call.channelId }?.serverId ?: place
                                }.padding(start = 16.dp, end = 4.dp, top = 2.dp, bottom = 2.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Text("Em chamada · $callName — toque para voltar", color = Ink.Ink0, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                                IconButton(onClick = { vm.toggleMute() }) {
                                    Icon(if (call.muted) Icons.Filled.MicOff else Icons.Filled.Mic, contentDescription = if (call.muted) "Ativar microfone" else "Silenciar microfone", tint = Ink.Ink0)
                                }
                                Text("Sair", color = Ink.Ink0, fontWeight = FontWeight.ExtraBold, modifier = Modifier.clickable { vm.leaveCall() }.padding(horizontal = 12.dp, vertical = 10.dp))
                            }
                        }
                        PullToRefreshBox(isRefreshing = state.refreshing, onRefresh = vm::refresh, modifier = Modifier.weight(1f).fillMaxWidth()) {
                            when {
                                showFriends -> FriendList(state, vm) { profileId = it }
                                openChannel?.isVoice == true -> VoiceScreen(state, vm, openChannel)
                                dmCall != null -> Column(Modifier.fillMaxSize()) {
                                    Row(
                                        Modifier.fillMaxWidth().background(Ink.Ink1).clickable { dmCallId = null }.padding(horizontal = 16.dp, vertical = 10.dp),
                                        verticalAlignment = Alignment.CenterVertically,
                                    ) {
                                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = null, tint = Ink.Paper, modifier = Modifier.size(18.dp))
                                        Spacer(Modifier.width(8.dp))
                                        Text("Voltar para a conversa", color = Ink.Paper, style = MaterialTheme.typography.labelLarge)
                                    }
                                    Box(Modifier.weight(1f).fillMaxWidth()) { VoiceScreen(state, vm, dmCall) }
                                }
                                openId != null -> ChatScreen(state, vm, openId!!) { profileId = it }
                                else -> Placeholder("Arraste da borda esquerda", "Ou toque em ☰ para escolher um canal ou conversa.")
                            }
                            state.error?.let { msg ->
                                Text(
                                    msg,
                                    color = Ink.Ink0,
                                    style = MaterialTheme.typography.bodyMedium,
                                    modifier = Modifier.align(Alignment.TopCenter).fillMaxWidth().background(Ink.Paper)
                                        .clickable { vm.clearError() }.padding(horizontal = 16.dp, vertical = 10.dp),
                                )
                            }
                        }
                        }
                    }
                }
            }
        }
    }

    profileId?.let { id ->
        ProfileSheet(
            userId = id,
            myId = state.user?.id,
            vm = vm,
            onDismiss = { profileId = null },
            onMessage = { channelId -> profileId = null; openId = channelId; showFriends = false; place = HOME },
        )
    }
}

/** Barra de servidores (esquerda) + lista de canais/conversas + painel do usuário, como no desktop. */
@Composable
private fun Sidebar(
    state: UiState,
    vm: AppViewModel,
    place: String,
    unread: Map<String, Unread>,
    onPlace: (String) -> Unit,
    onFriends: () -> Unit,
    onOpen: (String) -> Unit,
) {
    var showServerDialog by remember { mutableStateOf(false) }

    Row(Modifier.fillMaxSize()) {
        // Barra de servidores
        LazyColumn(
            Modifier.width(76.dp).fillMaxHeight().background(Ink.Ink0).statusBarsPadding(),
            contentPadding = PaddingValues(vertical = 12.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            item {
                RailItem(selected = place == HOME, badge = state.unread.filter { it.serverId == null }.sumOf { it.count }, onClick = { onPlace(HOME) }) {
                    androidx.compose.foundation.Image(painterResource(R.drawable.turtle_mark), contentDescription = "Conversas", modifier = Modifier.size(30.dp))
                }
            }
            item { HorizontalDivider(Modifier.width(32.dp), color = Ink.Line) }
            items(state.servers, key = { it.id }) { s ->
                val count = state.unread.filter { it.serverId == s.id }.sumOf { it.count }
                RailItem(selected = place == s.id, badge = count, onClick = { onPlace(s.id) }) {
                    Avatar(s.name, vm.api.fileUrl(s.icon), size = 48.dp, square = true)
                }
            }
            item {
                RailItem(selected = false, badge = 0, onClick = { showServerDialog = true }) {
                    Icon(Icons.Filled.Add, contentDescription = "Criar ou entrar em servidor", tint = Ink.Paper)
                }
            }
        }

        // Lista de canais ou de conversas
        Column(Modifier.weight(1f).fillMaxHeight().background(Ink.Ink1)) {
            val server = state.servers.firstOrNull { it.id == place }
            Box(Modifier.fillMaxWidth().statusBarsPadding().padding(horizontal = 16.dp, vertical = 16.dp)) {
                Text(server?.name ?: "Mensagens diretas", style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            HorizontalDivider(color = Ink.Line)
            Box(Modifier.weight(1f)) {
                if (server == null) DmSidebar(state, vm, unread, onFriends, onOpen)
                else ChannelSidebar(server, state.channels[server.id].orEmpty(), unread, state.voiceStates, vm, onOpen)
            }
            UserPanel(state, vm)
        }
    }

    if (showServerDialog) {
        CreateOrJoinServerDialog(
            onDismiss = { showServerDialog = false },
            onCreate = { name ->
                vm.createServer(name) { server ->
                    showServerDialog = false
                    onPlace(server.id)
                }
            },
            onJoin = { code ->
                vm.joinInvite(code) { server ->
                    showServerDialog = false
                    onPlace(server.id)
                }
            },
        )
    }
}

@Composable
private fun RailItem(selected: Boolean, badge: Int, onClick: () -> Unit, content: @Composable () -> Unit) {
    Box(contentAlignment = Alignment.Center) {
        Box(
            Modifier.size(52.dp).clip(RoundedCornerShape(if (selected) 14.dp else 26.dp))
                .background(if (selected) Ink.Paper.copy(alpha = 0.14f) else Ink.Ink3)
                .then(if (selected) Modifier.border(2.dp, Ink.Paper, RoundedCornerShape(14.dp)) else Modifier)
                .clickable(onClick = onClick),
            contentAlignment = Alignment.Center,
        ) { content() }
        if (badge > 0) Badge(badge, Modifier.align(Alignment.BottomEnd))
    }
}

@Composable
private fun ChannelSidebar(
    server: Server,
    channels: List<Channel>,
    unread: Map<String, Unread>,
    voiceStates: List<VoiceState>,
    vm: AppViewModel,
    onOpen: (String) -> Unit,
) {
    val text = channels.filter { !it.isVoice }
    val voice = channels.filter { it.isVoice }
    val canManage = server.role == "owner" || server.role == "admin"
    var showCreateChannel by remember { mutableStateOf(false) }

    LazyColumn(contentPadding = PaddingValues(vertical = 8.dp)) {
        item {
            Row(
                Modifier.fillMaxWidth().padding(start = 16.dp, end = 8.dp, top = 4.dp, bottom = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                SectionLabel("Canais de texto", Modifier.weight(1f))
                if (canManage) {
                    IconButton(onClick = { showCreateChannel = true }, modifier = Modifier.size(28.dp)) {
                        Icon(Icons.Filled.Add, contentDescription = "Criar canal", tint = Ink.Muted, modifier = Modifier.size(18.dp))
                    }
                }
            }
        }
        items(text, key = { it.id }) { c -> ChannelRow(c.name, Icons.Filled.Tag, unread[c.id]?.count ?: 0) { onOpen(c.id) } }
        item { SectionLabel("Canais de voz", Modifier.padding(start = 16.dp, end = 16.dp, top = 20.dp, bottom = 8.dp)) }
        items(voice, key = { it.id }) { c ->
            ChannelRow(c.name, Icons.AutoMirrored.Filled.VolumeUp, 0) { onOpen(c.id) }
            // Quem está na chamada aparece embaixo do canal, como no desktop.
            voiceStates.filter { it.channelId == c.id }.forEach { v ->
                Row(Modifier.fillMaxWidth().padding(start = 46.dp, end = 16.dp, top = 2.dp, bottom = 2.dp), verticalAlignment = Alignment.CenterVertically) {
                    Avatar(v.shown, vm.api.fileUrl(v.avatar), size = 22.dp)
                    Spacer(Modifier.width(8.dp))
                    Text(v.shown, style = MaterialTheme.typography.bodyMedium, color = Ink.Muted, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                    if (v.screen) Text("AO VIVO", style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.ExtraBold, color = Ink.Paper)
                    else if (v.muted || v.deafened) Text("mudo", style = MaterialTheme.typography.labelSmall, color = Ink.Faint)
                }
            }
        }
    }

    if (showCreateChannel) {
        CreateChannelDialog(
            onDismiss = { showCreateChannel = false },
            onCreate = { name, kind ->
                vm.createChannel(server.id, name, kind) { channel ->
                    showCreateChannel = false
                    if (!channel.isVoice) onOpen(channel.id)
                }
            },
        )
    }
}

@Composable
private fun ChannelRow(name: String, icon: ImageVector, unread: Int, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 8.dp).clip(RoundedCornerShape(8.dp)).clickable(onClick = onClick).padding(horizontal = 10.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, contentDescription = null, tint = Ink.Muted, modifier = Modifier.size(20.dp))
        Spacer(Modifier.width(12.dp))
        Text(name, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
        Badge(unread)
    }
}

@Composable
private fun DmSidebar(state: UiState, vm: AppViewModel, unread: Map<String, Unread>, onFriends: () -> Unit, onOpen: (String) -> Unit) {
    LazyColumn(contentPadding = PaddingValues(vertical = 8.dp)) {
        item { ChannelRow("Amigos", Icons.Filled.Group, state.friends.count { it.status == "incoming" }, onFriends) }
        item { SectionLabel("Conversas", Modifier.padding(start = 16.dp, end = 16.dp, top = 16.dp, bottom = 8.dp)) }
        items(state.dms, key = { it.channelId }) { d ->
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 8.dp).clip(RoundedCornerShape(8.dp)).clickable { onOpen(d.channelId) }.padding(horizontal = 10.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                val other = d.users.firstOrNull()
                Avatar(
                    d.title, if (d.group) null else vm.api.fileUrl(other?.avatar), size = 36.dp,
                    status = if (!d.group && other != null && other.id in state.online) (if (other.id in state.dnd) "busy" else "online") else null,
                )
                Spacer(Modifier.width(12.dp))
                Text(d.title, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                // Alguém está na chamada desta conversa.
                if (state.voiceStates.any { it.channelId == d.channelId }) {
                    Icon(Icons.Filled.Call, contentDescription = "Chamada em andamento", tint = Ink.Paper, modifier = Modifier.padding(horizontal = 6.dp).size(16.dp))
                }
                Badge(unread[d.channelId]?.count ?: 0)
            }
        }
    }
}

/** Fundo da barra lateral: quem sou eu, status, edição de perfil e o botão de sair. */
@Composable
private fun UserPanel(state: UiState, vm: AppViewModel) {
    val me = state.user ?: return
    var statusMenuOpen by remember { mutableStateOf(false) }
    var showEditProfile by remember { mutableStateOf(false) }

    Column(Modifier.background(Ink.Ink0).navigationBarsPadding()) {
        HorizontalDivider(color = Ink.Line)
        Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.weight(1f)) {
                Row(
                    Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(8.dp))
                        .clickable { statusMenuOpen = true }
                        .padding(vertical = 2.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Avatar(me.shownName, vm.api.fileUrl(me.avatar), size = 38.dp, status = me.status, ring = Ink.Ink0)
                    Spacer(Modifier.width(10.dp))
                    Column(Modifier.weight(1f)) {
                        Text(me.shownName, style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text("@${me.username}", color = Ink.Muted, style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                }
                StatusPicker(
                    expanded = statusMenuOpen,
                    current = me.status,
                    onDismiss = { statusMenuOpen = false },
                    onPick = { vm.setStatus(it) },
                )
            }
            IconButton(onClick = { showEditProfile = true }) {
                Icon(Icons.Filled.Edit, contentDescription = "Editar perfil", tint = Ink.Muted)
            }
            IconButton(onClick = vm::logout) {
                Icon(Icons.AutoMirrored.Filled.Logout, contentDescription = "Sair da conta", tint = Ink.Muted)
            }
        }
    }

    if (showEditProfile) {
        EditProfileDialog(
            initialName = me.displayName.orEmpty(),
            initialBio = me.bio.orEmpty(),
            onDismiss = { showEditProfile = false },
            onSave = { name, bio ->
                vm.updateProfile(name, bio) { showEditProfile = false }
            },
        )
    }
}

@Composable
private fun FriendList(state: UiState, vm: AppViewModel, onProfile: (String) -> Unit) {
    var showAddDialog by remember { mutableStateOf(false) }
    var notice by remember { mutableStateOf<String?>(null) }

    Column(Modifier.fillMaxSize()) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            SectionLabel("Seus amigos")
            Button(
                onClick = { showAddDialog = true },
                colors = ButtonDefaults.buttonColors(containerColor = Ink.Paper, contentColor = Ink.Ink0),
                contentPadding = PaddingValues(horizontal = 14.dp, vertical = 8.dp),
            ) {
                Text("Adicionar amigo", fontWeight = FontWeight.Bold)
            }
        }

        notice?.let { msg ->
            Text(
                msg,
                color = Ink.Paper,
                style = MaterialTheme.typography.bodyMedium,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 4.dp)
                    .clip(RoundedCornerShape(8.dp))
                    .background(Ink.Ink3)
                    .border(1.dp, Ink.Line, RoundedCornerShape(8.dp))
                    .clickable { notice = null }
                    .padding(horizontal = 12.dp, vertical = 8.dp),
            )
        }

        if (state.friends.isEmpty()) {
            Box(Modifier.weight(1f).fillMaxWidth()) {
                Placeholder("Sem amigos por aqui ainda", "Adicione alguém pelo nome de usuário.")
            }
        } else {
            val groups = listOf("incoming" to "Pedidos recebidos", "friend" to "Amigos", "outgoing" to "Pedidos enviados")
            LazyColumn(Modifier.weight(1f), contentPadding = PaddingValues(vertical = 8.dp)) {
                groups.forEach { (status, label) ->
                    val list = state.friends.filter { it.status == status }
                    if (list.isNotEmpty()) {
                        item(key = "h-$status") { SectionLabel("$label — ${list.size}", Modifier.padding(horizontal = 16.dp, vertical = 10.dp)) }
                        items(list, key = { "$status-${it.user.id}" }) { f ->
                            Row(
                                Modifier.fillMaxWidth().clickable { onProfile(f.user.id) }.padding(horizontal = 16.dp, vertical = 10.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Avatar(
                                    f.user.shownName,
                                    vm.api.fileUrl(f.user.avatar),
                                    size = 40.dp,
                                    ring = Ink.Ink2,
                                    status = if (f.user.id in state.online) (if (f.user.id in state.dnd) "busy" else "online") else null,
                                )
                                Spacer(Modifier.width(14.dp))
                                Column(Modifier.weight(1f)) {
                                    Text(f.user.shownName, style = MaterialTheme.typography.titleMedium)
                                    if (f.user.displayName != null) Text("@${f.user.username}", color = Ink.Muted, style = MaterialTheme.typography.bodyMedium)
                                    if (f.user.id in state.online) state.activityOf(f.user.id)?.let {
                                        Text(it, color = Ink.Muted, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                    }
                                }
                                if (status == "incoming") {
                                    IconButton(onClick = { vm.setFriend(f.user.id, true) {} }) {
                                        Icon(Icons.Filled.Check, contentDescription = "Aceitar", tint = Ink.Paper)
                                    }
                                    IconButton(onClick = { vm.setFriend(f.user.id, false) {} }) {
                                        Icon(Icons.Filled.Close, contentDescription = "Recusar", tint = Ink.Muted)
                                    }
                                } else if (status == "outgoing") {
                                    IconButton(onClick = { vm.setFriend(f.user.id, false) {} }) {
                                        Icon(Icons.Filled.Close, contentDescription = "Cancelar pedido", tint = Ink.Muted)
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    if (showAddDialog) {
        AddFriendDialog(
            onDismiss = { showAddDialog = false },
            onAdd = { username ->
                vm.addFriendByName(username) { resStatus ->
                    showAddDialog = false
                    notice = if (resStatus == "friend") "Agora vocês são amigos" else "Pedido enviado"
                }
            },
        )
    }
}

@Composable
private fun Placeholder(title: String, text: String) {
    Column(Modifier.fillMaxSize().padding(32.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
        Text(title, style = MaterialTheme.typography.titleMedium)
        Text(text, color = Ink.Muted, modifier = Modifier.padding(top = 6.dp))
    }
}
