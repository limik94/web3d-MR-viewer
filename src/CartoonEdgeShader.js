import * as THREE from 'three';

const outlineVertexShader = /* glsl */`
  uniform float thickness;

  void main() {
    vec3 expanded = position + normalize(normal) * thickness;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(expanded, 1.0);
  }
`;

const outlineFragmentShader = /* glsl */`
  uniform vec3 color;

  void main() {
    gl_FragColor = vec4(color, 1.0);
  }
`;

const tintVertexShader = /* glsl */`
  uniform float offset;

  void main() {
    vec3 expanded = position + normalize(normal) * offset;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(expanded, 1.0);
  }
`;

const tintFragmentShader = /* glsl */`
  uniform vec3 color;
  uniform float alpha;

  void main() {
    gl_FragColor = vec4(color, alpha);
  }
`;

export class CartoonOutline {
  constructor(target, options = {}) {
    this.options = {
      thickness: 0.01,
      color: 0x000000,
      renderOrder: 95,
      ...options,
    };
    this.outlineMeshes = [];
    this.material = new THREE.ShaderMaterial({
      vertexShader: outlineVertexShader,
      fragmentShader: outlineFragmentShader,
      uniforms: {
        thickness: { value: this.options.thickness },
        color: { value: new THREE.Color(this.options.color) },
      },
      side: THREE.BackSide,
      depthTest: true,
      depthWrite: false,
    });
    this.build(target);
  }

  build(target) {
    target.traverse((child) => {
      if (!child.isMesh || !child.geometry || child.userData?.isSelectionOutline || child.userData?.isPickingTint) return;

      const outline = new THREE.Mesh(child.geometry, this.material);
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
    this.material.uniforms.thickness.value = value;
  }

  setColor(color) {
    this.material.uniforms.color.value.set(color);
  }

  dispose() {
    this.outlineMeshes.forEach((mesh) => {
      mesh.parent?.remove(mesh);
    });
    this.material.dispose();
    this.outlineMeshes = [];
  }
}

export class PickingTint {
  constructor(target, options = {}) {
    this.options = {
      color: 0x38bdf8,
      alpha: 0.28,
      offset: 0.0015,
      renderOrder: 90,
      ...options,
    };
    this.tintMeshes = [];
    this.material = new THREE.ShaderMaterial({
      vertexShader: tintVertexShader,
      fragmentShader: tintFragmentShader,
      uniforms: {
        color: { value: new THREE.Color(this.options.color) },
        alpha: { value: this.options.alpha },
        offset: { value: this.options.offset },
      },
      side: THREE.FrontSide,
      transparent: true,
      depthTest: true,
      depthWrite: false,
    });
    this.build(target);
  }

  build(target) {
    target.traverse((child) => {
      if (!child.isMesh || !child.geometry || child.userData?.isSelectionOutline || child.userData?.isPickingTint) return;

      const tint = new THREE.Mesh(child.geometry, this.material);
      tint.name = `${child.name || 'mesh'}_picking_tint`;
      tint.renderOrder = this.options.renderOrder;
      tint.frustumCulled = false;
      tint.userData.isPickingTint = true;
      child.add(tint);
      this.tintMeshes.push(tint);
    });
  }

  setVisible(visible) {
    this.tintMeshes.forEach((mesh) => {
      mesh.visible = visible;
    });
  }

  setColor(color) {
    this.material.uniforms.color.value.set(color);
  }

  dispose() {
    this.tintMeshes.forEach((mesh) => {
      mesh.parent?.remove(mesh);
    });
    this.material.dispose();
    this.tintMeshes = [];
  }
}
