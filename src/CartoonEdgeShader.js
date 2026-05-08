import * as THREE from 'three';

export const CartoonOutlineShader = {
  vertexShader: /* glsl */`
    uniform float outlineThickness;
    uniform float thicknessScale;
    uniform float screenSpace;

    void main() {
      vec4 worldPos = modelMatrix * vec4(position, 1.0);
      vec4 viewPos = viewMatrix * worldPos;
      vec3 nrm = normalize(normal);

      if (screenSpace > 0.5) {
        vec4 clipPos = projectionMatrix * viewPos;
        vec3 clipNormal = normalize(
          (projectionMatrix * viewMatrix * modelMatrix * vec4(nrm, 0.0)).xyz
        );
        clipPos.xy += clipNormal.xy * outlineThickness * clipPos.w;
        gl_Position = clipPos;
      } else {
        float dist = -viewPos.z;
        float thick = outlineThickness * (1.0 + dist * thicknessScale);
        vec3 expanded = position + nrm * thick;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(expanded, 1.0);
      }
    }
  `,

  fragmentShader: /* glsl */`
    uniform vec3 outlineColor;
    uniform float outlineAlpha;

    void main() {
      gl_FragColor = vec4(outlineColor, outlineAlpha);
    }
  `,

  defaultUniforms() {
    return {
      outlineThickness: { value: 0.02 },
      thicknessScale: { value: 0.0 },
      screenSpace: { value: 0.0 },
      outlineColor: { value: new THREE.Color(0x000000) },
      outlineAlpha: { value: 1.0 },
    };
  },
};

export const CartoonSurfaceShader = {
  vertexShader: /* glsl */`
    varying vec3 vNormal;
    varying vec3 vWorldPos;

    void main() {
      vNormal = normalize(normalMatrix * normal);
      vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,

  fragmentShader: /* glsl */`
    uniform vec3 baseColor;
    uniform vec3 lightDirection;
    uniform vec3 lightColor;
    uniform vec3 ambientColor;
    uniform float toonLevels;
    uniform float rimPower;
    uniform vec3 rimColor;
    uniform float rimStrength;

    varying vec3 vNormal;
    varying vec3 vWorldPos;

    void main() {
      vec3 N = normalize(vNormal);
      vec3 L = normalize(lightDirection);
      float NdotL = max(dot(N, L), 0.0);
      float toon = floor(NdotL * toonLevels) / toonLevels;
      vec3 V = normalize(cameraPosition - vWorldPos);
      float rim = pow(1.0 - max(dot(V, N), 0.0), rimPower) * rimStrength;
      vec3 color = baseColor * (ambientColor + lightColor * toon);
      color += rimColor * rim;
      gl_FragColor = vec4(color, 1.0);
    }
  `,

  defaultUniforms() {
    return {
      baseColor: { value: new THREE.Color(0xffaa66) },
      lightDirection: { value: new THREE.Vector3(0.5, 1.0, 0.5).normalize() },
      lightColor: { value: new THREE.Color(0xffffff) },
      ambientColor: { value: new THREE.Color(0x404040) },
      toonLevels: { value: 3.0 },
      rimPower: { value: 3.0 },
      rimStrength: { value: 0.6 },
      rimColor: { value: new THREE.Color(0xffffff) },
    };
  },
};

export class CartoonOutline {
  constructor(target, options = {}) {
    this.target = target;
    this.options = {
      thickness: 0.02,
      color: 0x000000,
      alpha: 1.0,
      thicknessScale: 0.0,
      screenSpace: false,
      renderOrder: 999,
      ...options,
    };
    this.outlineMeshes = [];
    this._build();
  }

  _build() {
    this.target.traverse((child) => {
      if (!child.isMesh || !child.geometry || child.userData?.isSelectionOutline) return;

      const uniforms = CartoonOutlineShader.defaultUniforms();
      uniforms.outlineThickness.value = this.options.thickness;
      uniforms.thicknessScale.value = this.options.thicknessScale;
      uniforms.screenSpace.value = this.options.screenSpace ? 1.0 : 0.0;
      uniforms.outlineColor.value = new THREE.Color(this.options.color);
      uniforms.outlineAlpha.value = this.options.alpha;

      const outlineMaterial = new THREE.ShaderMaterial({
        vertexShader: CartoonOutlineShader.vertexShader,
        fragmentShader: CartoonOutlineShader.fragmentShader,
        uniforms,
        side: THREE.BackSide,
        depthWrite: true,
        depthTest: true,
        transparent: this.options.alpha < 1,
      });

      const outline = new THREE.Mesh(child.geometry, outlineMaterial);
      outline.name = `${child.name || 'mesh'}_outline`;
      outline.renderOrder = this.options.renderOrder;
      outline.frustumCulled = false;
      outline.userData.isSelectionOutline = true;

      child.add(outline);
      this.outlineMeshes.push(outline);
    });
  }

  setVisible(visible) {
    this.outlineMeshes.forEach((mesh) => {
      mesh.visible = visible;
    });
  }

  setThickness(value) {
    this.outlineMeshes.forEach((mesh) => {
      mesh.material.uniforms.outlineThickness.value = value;
    });
  }

  setColor(color) {
    this.outlineMeshes.forEach((mesh) => {
      mesh.material.uniforms.outlineColor.value.set(color);
    });
  }

  dispose() {
    this.outlineMeshes.forEach((mesh) => {
      mesh.parent?.remove(mesh);
      mesh.material.dispose();
    });
    this.outlineMeshes = [];
  }
}
