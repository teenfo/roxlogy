package app.roxlogy.android.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import app.roxlogy.android.R
import app.roxlogy.android.ui.theme.RoxAccent
import app.roxlogy.android.ui.theme.RoxBackground
import app.roxlogy.android.ui.theme.RoxForeground
import app.roxlogy.android.ui.theme.RoxMuted
import app.roxlogy.android.ui.theme.RoxSurface
import androidx.compose.foundation.text.KeyboardOptions

/**
 * 로고 마크: 옐로 8세그먼트 링(스테이션) + 블루 트랙 링(러닝) + 인더스트리얼 R.
 * 공식 브랜드 에셋(brand/roxlogy-mark.svg → drawable/ic_rox_mark)을 직접 사용한다. 손으로 다시 그리지 않는다.
 */
@Composable
fun RoxMark(size: Dp = 64.dp) {
    Image(
        painter = painterResource(R.drawable.ic_rox_mark),
        contentDescription = "Roxlogy",
        modifier = Modifier.size(size),
    )
}

@Composable
fun RoxTextField(
    value: String,
    onValueChange: (String) -> Unit,
    label: String,
    modifier: Modifier = Modifier,
    keyboardType: KeyboardType = KeyboardType.Text,
    visualTransformation: VisualTransformation = VisualTransformation.None,
    trailingIcon: (@Composable () -> Unit)? = null,
) {
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        label = { Text(label) },
        singleLine = true,
        visualTransformation = visualTransformation,
        keyboardOptions = KeyboardOptions(keyboardType = keyboardType),
        trailingIcon = trailingIcon,
        shape = MaterialTheme.shapes.medium,
        colors = OutlinedTextFieldDefaults.colors(
            focusedBorderColor = RoxAccent,
            unfocusedBorderColor = RoxMuted.copy(alpha = 0.4f),
            focusedContainerColor = RoxSurface,
            unfocusedContainerColor = RoxSurface,
            focusedLabelColor = RoxAccent,
            unfocusedLabelColor = RoxMuted,
            cursorColor = RoxAccent,
            focusedTextColor = RoxForeground,
            unfocusedTextColor = RoxForeground,
        ),
        modifier = modifier.fillMaxWidth(),
    )
}

@Composable
fun RoxPrimaryButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
) {
    Button(
        onClick = onClick,
        enabled = enabled,
        shape = MaterialTheme.shapes.medium,
        colors = ButtonDefaults.buttonColors(
            containerColor = RoxAccent,
            contentColor = RoxBackground,
            disabledContainerColor = RoxAccent.copy(alpha = 0.4f),
            disabledContentColor = RoxBackground.copy(alpha = 0.6f),
        ),
        modifier = modifier.fillMaxWidth().height(50.dp),
    ) {
        Text(text, style = MaterialTheme.typography.labelLarge)
    }
}

@Composable
fun RoxOutlineButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    leading: (@Composable () -> Unit)? = null,
) {
    OutlinedButton(
        onClick = onClick,
        shape = MaterialTheme.shapes.medium,
        border = BorderStroke(1.dp, RoxMuted.copy(alpha = 0.4f)),
        colors = ButtonDefaults.outlinedButtonColors(
            containerColor = RoxSurface,
            contentColor = RoxForeground,
        ),
        modifier = modifier.fillMaxWidth().height(50.dp),
    ) {
        if (leading != null) {
            leading()
            Spacer(Modifier.width(10.dp))
        }
        Text(text, style = MaterialTheme.typography.titleMedium)
    }
}

@Composable
fun OrDivider(text: String) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.Center) {
        Spacer(Modifier.weight(1f).height(1.dp).background(RoxMuted.copy(alpha = 0.3f)))
        Text(
            "  $text  ",
            color = RoxMuted,
            style = MaterialTheme.typography.labelSmall,
        )
        Spacer(Modifier.weight(1f).height(1.dp).background(RoxMuted.copy(alpha = 0.3f)))
    }
}
