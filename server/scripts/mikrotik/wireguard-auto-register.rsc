# WireGuard auto-register for RouterOS v7+
# -----------------------------------------------------------------------------
# Router phones home to the cloud API (no need for cloud to reach LAN).
#
# 1) Download this .rsc from QareFi (Add router)
# 2) /tool fetch ... OR Winbox Files Upload, then: /import qarefi-install.rsc
# 3) In QareFi: Finish tab -> peer appears -> enter SSH user/password
# -----------------------------------------------------------------------------

:local API_BASE "https://ipaynotifyserver.onrender.com"
# Filled by QareFi when you download (links peer to your organization)
:local ORG_ID ""
# "auto" = /system identity name (set a clear identity per site in Winbox)
:local SITE_NAME "auto"
# "auto" = first DHCP server network, else bridge LAN address as /24
:local LAN_SUBNET "auto"
:local REGISTER_TOKEN ""
:local WG_IFACE "wg-qarefi"
:local WG_LISTEN_PORT 51820
:local WG_MTU 1420
:local WG_POOL "10.66.54.0/24"
:local VPN_MGMT_COMMENT "QareFi: VPN management"

:log info "wg-auto-register: starting"

# --- Auto SITE_NAME from System -> Identity ---
:if (($SITE_NAME = "") || ($SITE_NAME = "auto") || ($SITE_NAME = "site-unnamed")) do={
  :set SITE_NAME [/system identity get name]
}
# Spaces break form POST - use dashes
:while ([:find $SITE_NAME " "] != nil) do={
  :local sp [:find $SITE_NAME " "]
  :set SITE_NAME ([:pick $SITE_NAME 0 $sp] . "-" . [:pick $SITE_NAME ($sp + 1) [:len $SITE_NAME]])
}
:if ([:len $SITE_NAME] < 2) do={
  :set SITE_NAME ("mt-" . [/system routerboard get serial-number])
}
:log info ("wg-auto-register: siteName=" . $SITE_NAME)

# --- Auto LAN_SUBNET from DHCP network or bridge IP ---
:if (($LAN_SUBNET = "") || ($LAN_SUBNET = "auto")) do={
  :set LAN_SUBNET ""
  :local dhcpNets [/ip dhcp-server network find]
  :if ([:len $dhcpNets] > 0) do={
    :set LAN_SUBNET [/ip dhcp-server network get ($dhcpNets->0) address]
    :log info ("wg-auto-register: LAN from DHCP network=" . $LAN_SUBNET)
  }
  :if ([:len $LAN_SUBNET] = 0) do={
    :local brIds [/ip address find where interface~"bridge" && disabled=no]
    :if ([:len $brIds] = 0) do={
      :set brIds [/ip address find where interface="ether1" && disabled=no]
    }
    :if ([:len $brIds] > 0) do={
      :local addr [/ip address get ($brIds->0) address]
      :local slash [:find $addr "/"]
      :if ($slash != nil) do={
        :local ipOnly [:pick $addr 0 $slash]
        :local d1 [:find $ipOnly "."]
        :local d2 [:find $ipOnly "." ($d1 + 1)]
        :local d3 [:find $ipOnly "." ($d2 + 1)]
        :if ($d3 != nil) do={
          :local prefix [:pick $ipOnly 0 $d3]
          :set LAN_SUBNET ($prefix . ".0/24")
          :log info ("wg-auto-register: LAN from interface IP=" . $LAN_SUBNET)
        }
      }
    }
  }
}
:if ([:len $LAN_SUBNET] > 0) do={
  :log info ("wg-auto-register: lanSubnet=" . $LAN_SUBNET)
} else={
  :log warning "wg-auto-register: lanSubnet empty (optional)"
}

:if ([:len [/interface wireguard find where name=$WG_IFACE]] = 0) do={
  /interface wireguard add name=$WG_IFACE listen-port=$WG_LISTEN_PORT mtu=$WG_MTU disabled=no comment="QareFi auto VPN"
  :log info ("wg-auto-register: created interface " . $WG_IFACE)
} else={
  :log info ("wg-auto-register: interface exists " . $WG_IFACE)
}

:delay 2s
:local MY_PUB [/interface wireguard get [find where name=$WG_IFACE] public-key]
:if ([:len $MY_PUB] < 40) do={
  :log error "wg-auto-register: FAILED - could not read local public-key"
  :error "missing public-key"
}
:log info ("wg-auto-register: local public-key ok len=" . [:len $MY_PUB])

:local httpData ("publicKey=" . $MY_PUB . "&siteName=" . $SITE_NAME)
:if ([:len $LAN_SUBNET] > 0) do={
  :set httpData ($httpData . "&lanSubnet=" . $LAN_SUBNET)
}
:if ([:len $REGISTER_TOKEN] > 0) do={
  :set httpData ($httpData . "&token=" . $REGISTER_TOKEN)
}
:if ([:len $ORG_ID] > 0) do={
  :set httpData ($httpData . "&organizationId=" . $ORG_ID)
}

:local url ($API_BASE . "/api/routers/register")
:local tmpFile "wg-register-response.txt"

:log info ("wg-auto-register: posting to " . $url)

:do {
  /tool fetch url=$url http-method=post http-data=$httpData http-header-field="Content-Type: application/x-www-form-urlencoded" dst-path=$tmpFile keep-result=yes
} on-error={
  :log error "wg-auto-register: FAILED - /tool fetch error (DNS, TLS, or URL)"
  :error "fetch failed"
}

:if ([:len [/file find where name=$tmpFile]] = 0) do={
  :log error "wg-auto-register: FAILED - empty fetch result"
  :error "no response file"
}

:local raw [/file get [find where name=$tmpFile] contents]
:if ([:len $raw] = 0) do={
  :log error "wg-auto-register: FAILED - blank response body"
  :error "blank response"
}

:local tunnelIp ""
:local serverPublicKey ""
:local endpoint ""
:local allowedIps ""
:local okFlag ""
:local errMsg ""

:local pos 0
:local textLen [:len $raw]
:while ($pos < $textLen) do={
  :local nl [:find $raw "\n" $pos]
  :local line ""
  :if ($nl = nil) do={
    :set line [:pick $raw $pos $textLen]
    :set pos $textLen
  } else={
    :set line [:pick $raw $pos $nl]
    :set pos ($nl + 1)
  }
  :local cr [:find $line "\r"]
  :if ($cr != nil) do={ :set line [:pick $line 0 $cr] }

  :local eq [:find $line "="]
  :if ($eq != nil) do={
    :local k [:pick $line 0 $eq]
    :local v [:pick $line ($eq + 1) [:len $line]]
    :if ($k = "tunnelIp") do={ :set tunnelIp $v }
    :if ($k = "serverPublicKey") do={ :set serverPublicKey $v }
    :if ($k = "endpoint") do={ :set endpoint $v }
    :if ($k = "allowedIps") do={ :set allowedIps $v }
    :if ($k = "ok") do={ :set okFlag $v }
    :if ($k = "error") do={ :set errMsg $v }
  }
}

:if (($okFlag != "true") || ([:len $tunnelIp] = 0) || ([:len $serverPublicKey] = 0) || ([:len $endpoint] = 0)) do={
  :log error ("wg-auto-register: FAILED - ok=" . $okFlag . " error=" . $errMsg)
  :error ("registration failed: " . $errMsg)
}

:if ([:len $allowedIps] = 0) do={ :set allowedIps $WG_POOL }

:local colon [:find $endpoint ":"]
:if ($colon = nil) do={
  :log error "wg-auto-register: FAILED - endpoint missing port"
  :error "bad endpoint"
}
:local epHost [:pick $endpoint 0 $colon]
:local epPort [:pick $endpoint ($colon + 1) [:len $endpoint]]

:log info ("wg-auto-register: assigned tunnelIp=" . $tunnelIp)

:local addrComment "QareFi WG tunnel"
:if ([:len [/ip address find where interface=$WG_IFACE comment=$addrComment]] = 0) do={
  /ip address add address=($tunnelIp . "/24") interface=$WG_IFACE comment=$addrComment
} else={
  /ip address set [find where interface=$WG_IFACE comment=$addrComment] address=($tunnelIp . "/24")
}

:if ([:len [/interface wireguard peers find where interface=$WG_IFACE public-key="$serverPublicKey"]] = 0) do={
  /interface wireguard peers add interface=$WG_IFACE public-key="$serverPublicKey" endpoint-address=$epHost endpoint-port=$epPort allowed-address="$allowedIps" persistent-keepalive=25s comment="QareFi VPS"
} else={
  /interface wireguard peers set [find where interface=$WG_IFACE public-key="$serverPublicKey"] endpoint-address=$epHost endpoint-port=$epPort allowed-address="$allowedIps" persistent-keepalive=25s comment="QareFi VPS"
}

# Allow cloud management over the VPN (SSH / Winbox / API)
:if ([:len [/ip firewall filter find where comment=$VPN_MGMT_COMMENT]] = 0) do={
  :do {
    /ip firewall filter add chain=input action=accept src-address=$WG_POOL comment=$VPN_MGMT_COMMENT place-before=0
  } on-error={
    /ip firewall filter add chain=input action=accept src-address=$WG_POOL comment=$VPN_MGMT_COMMENT
  }
}

:do {
  :local sshId [/ip service find where name="ssh"]
  :if ([:len $sshId] > 0) do={ /ip service set $sshId disabled=no }
  :local apiId [/ip service find where name="api"]
  :if ([:len $apiId] > 0) do={ /ip service set $apiId disabled=no }
  :local wbId [/ip service find where name="winbox"]
  :if ([:len $wbId] > 0) do={ /ip service set $wbId disabled=no }
} on-error={}

:log info ("wg-auto-register: SUCCESS - tunnelIp=" . $tunnelIp . " - finish Add router in QareFi with SSH login")
:do { /file remove [find where name=$tmpFile] } on-error={}
